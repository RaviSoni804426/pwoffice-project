const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Validate critical environment variables
const criticalEnvVars = ['JWT_SECRET', 'GROQ_API_KEY'];
const missingEnvVars = criticalEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`FATAL ERROR: Missing critical environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy (Nginx) so req.ip reflects the real client IP.
// Critical for rate limiting and IP-based security behind a reverse proxy.
app.set('trust proxy', 1);

// Setup View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const helmet = require('helmet');
const cors = require('cors');

// CORS Configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : [
        'http://localhost:3000', 
        'http://host.docker.internal:3000',
        process.env.WEBAPP_PUBLIC_URL,
        process.env.DOCUMENT_SERVER_PUBLIC_URL
      ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};
app.use(cors(corsOptions));

// Helmet Configuration for Security Headers (specifically configured for OnlyOffice compatibility)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": [
        "'self'", 
        "'unsafe-inline'", 
        "'unsafe-eval'",
        process.env.DOCUMENT_SERVER_PUBLIC_URL || 'http://localhost'
      ],
      "style-src": [
        "'self'", 
        "'unsafe-inline'", 
        "https://fonts.googleapis.com"
      ],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:", "*"],
      "frame-src": [
        "'self'",
        process.env.DOCUMENT_SERVER_PUBLIC_URL || 'http://localhost'
      ],
      "connect-src": ["'self'", "*"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Serve Static Files
app.use(express.static(path.join(__dirname, 'public')));

const { isTokenBlacklisted } = require('./middleware/auth');

// Global Middleware to load user from JWT cookie if it exists
app.use(async (req, res, next) => {
  const token = req.cookies.auth_token;
  if (token) {
    const blacklisted = await isTokenBlacklisted(token);
    if (!blacklisted) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        res.locals.user = decoded;
      } catch (err) {
        res.clearCookie('auth_token');
      }
    } else {
      res.clearCookie('auth_token');
    }
  }
  next();
});

// Import Routes
const authRoutes = require('./routes/auth');
const workspaceRoutes = require('./routes/workspace');
const editorRoutes = require('./routes/editor');
const chatRoutes = require('./routes/chat');

// Mount Routes
app.use('/', authRoutes);
app.use('/', workspaceRoutes);
app.use('/', editorRoutes);
app.use('/', chatRoutes);

const axios = require('axios');
const { query, dbMode } = require('./db');

// Healthcheck Endpoint
app.get('/api/health', async (req, res) => {
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: { status: 'unknown' },
    documentServer: { status: 'unknown' }
  };

  let isHealthy = true;

  // 1. Check database connectivity
  try {
    if (dbMode === 'postgres') {
      const dbRes = await query.get('SELECT 1');
      if (dbRes) {
        healthStatus.database.status = 'connected (PostgreSQL)';
      } else {
        isHealthy = false;
        healthStatus.database.status = 'disconnected';
      }
    } else {
      const dbRes = await query.get('SELECT 1');
      if (dbRes) {
        healthStatus.database.status = 'connected (SQLite)';
      } else {
        isHealthy = false;
        healthStatus.database.status = 'disconnected';
      }
    }
  } catch (err) {
    isHealthy = false;
    healthStatus.database.status = 'error';
    healthStatus.database.error = err.message;
  }

  // 2. Check Document Server status
  const docServerUrl = process.env.DOCUMENT_SERVER_INTERNAL_URL || process.env.DOCUMENT_SERVER_PUBLIC_URL || 'http://localhost';
  try {
    // OnlyOffice healthcheck endpoint returns "true" or 200 OK
    const docRes = await axios.get(`${docServerUrl}/healthcheck`, { timeout: 3000 });
    if (docRes.status === 200) {
      healthStatus.documentServer.status = 'online';
    } else {
      isHealthy = false;
      healthStatus.documentServer.status = 'unexpected_status';
      healthStatus.documentServer.statusCode = docRes.status;
    }
  } catch (err) {
    isHealthy = false;
    healthStatus.documentServer.status = 'offline';
    healthStatus.documentServer.error = err.message;
  }

  healthStatus.status = isHealthy ? 'healthy' : 'unhealthy';
  res.status(isHealthy ? 200 : 500).json(healthStatus);
});

// Landing Page Route
app.get('/', (req, res) => {
  res.render('landing');
});

// Privacy Policy Route
app.get('/privacy', (req, res) => {
  res.render('privacy');
});

// Terms of Service Route
app.get('/terms', (req, res) => {
  res.render('terms');
});

// 404 Route
app.use((req, res) => {
  res.status(404).render('error', {
    statusCode: 404,
    title: 'Page Not Found',
    message: "The page you're looking for doesn't exist, has been moved, or is temporarily unavailable."
  });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).render('error', {
    statusCode: err.status || 500,
    title: 'Internal Server Error',
    message: 'An unexpected error occurred on our server. We are looking into the issue.'
  });
});

// Start Server after DB Init
async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`  PW Office Web App running locally at:`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
}

start();
