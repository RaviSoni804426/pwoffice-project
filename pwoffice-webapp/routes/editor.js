const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');

// Helper for download retry logic on external PWOFFICE callback url
async function getWithRetry(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios({ url, ...options });
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`Transient fetch failure on ${url}, retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// GET Editor Page
router.get('/editor/:docId', requireAuth, async (req, res) => {
  const docId = req.params.docId;

  try {
    const document = await query.get('SELECT * FROM documents WHERE id = ?', [docId]);
    if (!document) {
      return res.redirect('/workspaces');
    }

    // Verify user belongs to workspace
    const link = await query.get(
      'SELECT * FROM user_workspaces WHERE user_id = ? AND workspace_id = ?',
      [req.user.id, document.workspace_id]
    );
    if (!link) {
      return res.redirect('/workspaces');
    }

    // Check if PWOFFICE Document Server is online
    // The Document Server can take 30-60s to fully start after docker-compose up,
    // so we retry a few times before declaring it offline.
    const docServerUrl = process.env.DOCUMENT_SERVER_INTERNAL_URL || process.env.DOCUMENT_SERVER_PUBLIC_URL || 'http://localhost';
    let isDocServerOnline = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const healthRes = await axios.get(`${docServerUrl}/healthcheck`, { timeout: 5000 });
        if (healthRes.status === 200) {
          isDocServerOnline = true;
          break;
        }
      } catch (err) {
        console.warn(`Healthcheck attempt ${attempt}/3 failed for ${docServerUrl}/healthcheck:`, err.message, err.response?.status || '');
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    if (!isDocServerOnline) {
      return res.status(503).render('error', {
        statusCode: 503,
        title: 'Editor Temporarily Unavailable',
        message: 'The document editing service is temporarily offline or undergoing maintenance. Your documents are safe. Please try again in a few moments.'
      });
    }

    // Determine document type for PWOFFICE
    // "word" for text documents (.docx)
    // "cell" for spreadsheets (.xlsx)
    // "slide" for presentations (.pptx)
    let documentType = 'word';
    if (document.file_type === 'xlsx') documentType = 'cell';
    if (document.file_type === 'pptx') documentType = 'slide';

    // Unique key for PWOFFICE to identify the file version.
    // If the key changes, PWOFFICE reloads the file.
    // We combine the doc ID, the timestamp of last modification, and a random string to bust cache.
    const lastModifiedMs = new Date(document.last_modified).getTime();
    const key = `${docId}_${lastModifiedMs}_${Date.now()}`;

    // URL for Document Server to download files and send callbacks
    const webappInternalUrl = process.env.WEBAPP_INTERNAL_URL || process.env.WEBAPP_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
    
    // URL for client browser to load assets
    const webappPublicUrl = process.env.WEBAPP_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

    // Generate a temporary download token to secure direct file access
    const downloadToken = jwt.sign(
      { docId: docId.toString(), userId: req.user.id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // PWOFFICE editor configuration object
    const editorConfig = {
      width: '100%',
      height: '100%',
      document: {
        fileType: document.file_type,
        key: key,
        title: document.filename,
        url: `${webappInternalUrl}/api/download/${docId}?token=${downloadToken}`,
        permissions: {
          edit: true,
          download: true,
          print: true
        }
      },
      documentType: documentType,
      editorConfig: {
        callbackUrl: `${webappInternalUrl}/api/callback/${docId}`,
        user: {
          id: req.user.id.toString(),
          name: req.user.name
        },
        mode: 'edit',
        customization: {
          about: false,
          feedback: false,
          chat: false,
          forcesave: false,
          hideRightMenu: false,
          hideRulers: false,
          compactHeader: false,
          toolbarNoTabs: false,
          toolbarHideFileName: false,
          autosave: true,
          windowed: false
        }
      }
    };

    // Sign configuration with PWOFFICE JWT Secret
    // PWOFFICE expects the entire config to be signed in a token
    const token = jwt.sign(editorConfig, process.env.JWT_SECRET, { algorithm: 'HS256' });
    editorConfig.token = token;

    res.render('editor', {
      config: editorConfig,
      docServerUrl: process.env.DOCUMENT_SERVER_PUBLIC_URL || 'http://localhost',
      document
    });
  } catch (err) {
    console.error('Error loading editor:', err);
    res.redirect('/workspaces');
  }
});

// GET Download file (PWOFFICE Server calls this to load the document)
router.get('/api/download/:docId', async (req, res) => {
  const docId = req.params.docId;
  const token = req.query.token;

  if (!token) {
    return res.status(403).send('Forbidden: Access token required');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.docId.toString() !== docId.toString()) {
      return res.status(403).send('Forbidden: Token mismatch');
    }
  } catch (err) {
    return res.status(403).send('Forbidden: Invalid or expired token');
  }

  try {
    const document = await query.get('SELECT * FROM documents WHERE id = ?', [docId]);
    if (!document || !document.storage_path || !fs.existsSync(document.storage_path)) {
      return res.status(404).send('File not found');
    }

    // Set headers
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.filename)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    fs.createReadStream(document.storage_path).pipe(res);
  } catch (err) {
    console.error('Error downloading file:', err);
    res.status(500).send('Internal Server Error');
  }
});

// POST Save Callback (PWOFFICE Server calls this when saving/editing)
router.post('/api/callback/:docId', async (req, res) => {
  const docId = req.params.docId;
  let body = req.body;

  console.log(`Callback received for document ${docId}. Headers:`, req.headers);

  // Parse JWT token from PWOFFICE callback if present
  // PWOFFICE sends JWT either in request header: Authorization: Bearer <token>
  // or inside request body: { token: <token> }
  let jwtToken = body.token;
  if (!jwtToken && req.headers['authorization']) {
    const authHeader = req.headers['authorization'];
    if (authHeader.startsWith('Bearer ')) {
      jwtToken = authHeader.substring(7);
    }
  }

  if (jwtToken) {
    try {
      const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET);
      body = decoded.payload || decoded; // The payload might be wrapped under 'payload' key
    } catch (err) {
      console.error('Callback JWT signature validation failed:', err.message);
      return res.status(403).send({ error: 1, message: 'Invalid JWT token' });
    }
  } else {
    // If JWT is configured as required, we must reject requests without token
    console.warn('Warning: PWOFFICE callback did not contain JWT token.');
  }

  console.log(`PWOFFICE Callback status for doc ${docId}:`, body.status);

  // Status 2: Document ready for saving (after close)
  // Status 6: Document force-saved (saving while open)
  if (body.status === 2 || body.status === 6) {
    const downloadUrl = body.url;
    if (!downloadUrl) {
      return res.status(400).send({ error: 1, message: 'Download URL missing' });
    }

    try {
      const document = await query.get('SELECT * FROM documents WHERE id = ?', [docId]);
      if (!document) {
        return res.status(404).send({ error: 1, message: 'Document not found' });
      }

      let internalDownloadUrl = downloadUrl;
      const publicUrl = process.env.DOCUMENT_SERVER_PUBLIC_URL || 'http://localhost';
      const internalUrl = process.env.DOCUMENT_SERVER_INTERNAL_URL || publicUrl;
      if (internalUrl !== publicUrl && downloadUrl.startsWith(publicUrl)) {
        internalDownloadUrl = downloadUrl.replace(publicUrl, internalUrl);
      }

      console.log(`Downloading updated file from PWOFFICE: ${internalDownloadUrl}`);

      const response = await getWithRetry(internalDownloadUrl, {
        method: 'get',
        responseType: 'stream'
      });

      const writer = fs.createWriteStream(document.storage_path);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // Update last_modified in DB
      await query.run(
        'UPDATE documents SET last_modified = CURRENT_TIMESTAMP WHERE id = ?',
        [docId]
      );

      console.log(`Document ${docId} successfully saved to storage.`);
    } catch (err) {
      console.error('Error saving file from PWOFFICE callback:', err);
      return res.status(500).send({ error: 1, message: 'Error saving document' });
    }
  }

  res.send({ error: 0 }); // Status 0 tells PWOFFICE that the callback succeeded
});

// GET Export / Download document in specified format (pdf, pptx, docx, xlsx, etc.)
router.get('/api/export/:docId', async (req, res) => {
  const docId = req.params.docId;
  const requestedFormat = (req.query.format || 'pdf').toLowerCase();

  try {
    const document = await query.get('SELECT * FROM documents WHERE id = ?', [docId]);
    if (!document || !document.storage_path || !fs.existsSync(document.storage_path)) {
      return res.status(404).send('Document not found');
    }

    const webappInternalUrl = process.env.WEBAPP_INTERNAL_URL || 'http://webapp:3000';
    const docServerInternalUrl = process.env.DOCUMENT_SERVER_INTERNAL_URL || 'http://docserver';

    const userId = req.user ? req.user.id.toString() : '1';

    const downloadToken = jwt.sign(
      { docId: docId.toString(), userId: userId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const fileUrl = `${webappInternalUrl}/api/download/${docId}?token=${downloadToken}`;
    const fileType = document.file_type;
    const lastModifiedMs = new Date(document.last_modified).getTime();
    const key = `${docId}_${lastModifiedMs}_${Date.now()}`;
    const baseName = document.filename.substring(0, document.filename.lastIndexOf('.')) || document.filename;
    const outputFilename = `${baseName}.${requestedFormat}`;

    // Construct ONLYOFFICE ConvertService payload
    const payload = {
      async: false,
      filetype: fileType,
      key: key,
      outputtype: requestedFormat,
      title: outputFilename,
      url: fileUrl
    };

    // Sign JWT token with server JWT_SECRET
    const token = jwt.sign(payload, process.env.JWT_SECRET);
    
    // Request conversion from ONLYOFFICE Document Server
    const convertRes = await axios.post(`${docServerInternalUrl}/ConvertService.ashx`, {
      ...payload,
      token
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    if (convertRes.data && convertRes.data.fileUrl) {
      let downloadConvertedUrl = convertRes.data.fileUrl;
      const publicUrl = process.env.DOCUMENT_SERVER_PUBLIC_URL || 'http://localhost';
      if (docServerInternalUrl !== publicUrl && downloadConvertedUrl.startsWith(publicUrl)) {
        downloadConvertedUrl = downloadConvertedUrl.replace(publicUrl, docServerInternalUrl);
      }

      console.log(`Downloading converted file from ONLYOFFICE: ${downloadConvertedUrl}`);
      const fileStream = await axios.get(downloadConvertedUrl, { responseType: 'stream' });
      
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outputFilename)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      fileStream.data.pipe(res);
    } else {
      console.error('ONLYOFFICE ConvertService error response:', convertRes.data);
      res.status(500).send('Document conversion failed');
    }
  } catch (err) {
    console.error('Error exporting document:', err.message);
    res.status(500).send('Error exporting document');
  }
});

module.exports = router;
