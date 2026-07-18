const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

// Configure Multer for file uploads (temp upload directory)
const uploadDir = path.resolve(__dirname, '../storage/temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '_' + file.originalname);
  }
});
const upload = multer({ storage });

// Helper to check if user has access to a workspace
async function checkWorkspaceAccess(userId, workspaceId) {
  const link = await query.get(
    'SELECT * FROM user_workspaces WHERE user_id = ? AND workspace_id = ?',
    [userId, workspaceId]
  );
  return !!link;
}

// GET list of workspaces
router.get('/workspaces', requireAuth, async (req, res) => {
  try {
    const workspaces = await query.all(
      `SELECT w.* FROM workspaces w
       JOIN user_workspaces uw ON w.id = uw.workspace_id
       WHERE uw.user_id = ?
       ORDER BY w.name`,
      [req.user.id]
    );
    res.render('workspaces', { workspaces, error: null });
  } catch (err) {
    console.error('Error fetching workspaces:', err);
    res.render('workspaces', { workspaces: [], error: 'Failed to load workspaces.' });
  }
});

// POST create workspace
router.post('/workspaces', requireAuth, async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.redirect('/workspaces');
  }

  try {
    // Start simple transaction-like sequence (SQLite auto-commits, but we'll do both steps)
    const wsResult = await query.run('INSERT INTO workspaces (name) VALUES (?)', [name.trim()]);
    const workspaceId = wsResult.lastID;

    await query.run(
      'INSERT INTO user_workspaces (user_id, workspace_id) VALUES (?, ?)',
      [req.user.id, workspaceId]
    );

    res.redirect(`/workspace/${workspaceId}`);
  } catch (err) {
    console.error('Error creating workspace:', err);
    res.redirect('/workspaces');
  }
});

// GET workspace dashboard (documents list)
router.get('/workspace/:id', requireAuth, async (req, res) => {
  const workspaceId = req.params.id;

  try {
    const hasAccess = await checkWorkspaceAccess(req.user.id, workspaceId);
    if (!hasAccess) {
      return res.redirect('/workspaces');
    }

    const workspace = await query.get('SELECT * FROM workspaces WHERE id = ?', [workspaceId]);
    const documents = await query.all(
      `SELECT d.*, u.name as owner_name FROM documents d
       JOIN users u ON d.owner_id = u.id
       WHERE d.workspace_id = ?
       ORDER BY d.last_modified DESC`,
      [workspaceId]
    );

    res.render('dashboard', { workspace, documents, error: req.query.error || null });
  } catch (err) {
    console.error('Error loading dashboard:', err);
    res.redirect('/workspaces');
  }
});

// POST Create new blank document
router.post('/workspace/:id/create', requireAuth, async (req, res) => {
  const workspaceId = req.params.id;
  const { filename, file_type } = req.body; // file_type: docx, xlsx, pptx

  if (!filename || !file_type) {
    return res.redirect(`/workspace/${workspaceId}?error=Filename and file type are required`);
  }

  try {
    const hasAccess = await checkWorkspaceAccess(req.user.id, workspaceId);
    if (!hasAccess) {
      return res.redirect('/workspaces');
    }

    // Clean extension if user provided it
    let baseName = filename.trim();
    if (baseName.endsWith('.' + file_type)) {
      baseName = baseName.slice(0, -(file_type.length + 1));
    }
    const cleanFilename = `${baseName}.${file_type}`;

    // Get template file path
    const templatePath = path.resolve(__dirname, `../templates/new.${file_type}`);
    if (!fs.existsSync(templatePath)) {
      return res.redirect(`/workspace/${workspaceId}?error=Template for ${file_type} not found. Please extract templates.`);
    }

    // Insert record to database first to get unique document ID
    const docResult = await query.run(
      `INSERT INTO documents (filename, workspace_id, owner_id, file_type, storage_path, last_modified) 
       VALUES (?, ?, ?, ?, '', CURRENT_TIMESTAMP)`,
      [cleanFilename, workspaceId, req.user.id, file_type]
    );
    const documentId = docResult.lastID;

    // Define storage location: storage/<workspace_id>/<doc_id>_<filename>
    const destDir = path.resolve(__dirname, `../storage/${workspaceId}`);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const storagePath = path.join(destDir, `${documentId}_${cleanFilename}`);

    // Copy template file
    fs.copyFileSync(templatePath, storagePath);
    fs.chmodSync(storagePath, 0o666);

    // Update database record with final storage path
    await query.run(
      'UPDATE documents SET storage_path = ? WHERE id = ?',
      [storagePath, documentId]
    );

    res.redirect(`/workspace/${workspaceId}`);
  } catch (err) {
    console.error('Error creating document:', err);
    res.redirect(`/workspace/${workspaceId}?error=Failed to create document.`);
  }
});

// POST Upload document
router.post('/workspace/:id/upload', requireAuth, upload.single('file'), async (req, res) => {
  const workspaceId = req.params.id;

  if (!req.file) {
    return res.redirect(`/workspace/${workspaceId}?error=No file selected.`);
  }

  try {
    const hasAccess = await checkWorkspaceAccess(req.user.id, workspaceId);
    if (!hasAccess) {
      // Clean temp upload file
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.redirect('/workspaces');
    }

    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase().replace('.', '');
    const allowedTypes = ['docx', 'xlsx', 'pptx'];

    if (!allowedTypes.includes(ext)) {
      // Clean temp file
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.redirect(`/workspace/${workspaceId}?error=Only .docx, .xlsx, and .pptx files are supported.`);
    }

    // Insert record
    const docResult = await query.run(
      `INSERT INTO documents (filename, workspace_id, owner_id, file_type, storage_path, last_modified) 
       VALUES (?, ?, ?, ?, '', CURRENT_TIMESTAMP)`,
      [originalName, workspaceId, req.user.id, ext]
    );
    const documentId = docResult.lastID;

    // Define destination path
    const destDir = path.resolve(__dirname, `../storage/${workspaceId}`);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const storagePath = path.join(destDir, `${documentId}_${originalName}`);

    // Move file from temp to final storage
    fs.renameSync(req.file.path, storagePath);
    fs.chmodSync(storagePath, 0o666);

    // Update storage path
    await query.run(
      'UPDATE documents SET storage_path = ? WHERE id = ?',
      [storagePath, documentId]
    );

    res.redirect(`/workspace/${workspaceId}`);
  } catch (err) {
    console.error('Error uploading document:', err);
    // Clean temp file if exists
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.redirect(`/workspace/${workspaceId}?error=Failed to upload document.`);
  }
});

// POST Delete document
router.post('/workspace/:id/delete/:docId', requireAuth, async (req, res) => {
  const workspaceId = req.params.id;
  const docId = req.params.docId;

  try {
    const hasAccess = await checkWorkspaceAccess(req.user.id, workspaceId);
    if (!hasAccess) {
      return res.redirect('/workspaces');
    }

    const document = await query.get(
      'SELECT * FROM documents WHERE id = ? AND workspace_id = ?',
      [docId, workspaceId]
    );

    if (document) {
      // Delete file from disk if it exists
      if (document.storage_path && fs.existsSync(document.storage_path)) {
        fs.unlinkSync(document.storage_path);
      }
      // Delete database record
      await query.run('DELETE FROM documents WHERE id = ?', [docId]);
    }

    res.redirect(`/workspace/${workspaceId}`);
  } catch (err) {
    console.error('Error deleting document:', err);
    res.redirect(`/workspace/${workspaceId}?error=Failed to delete document.`);
  }
});

module.exports = router;
