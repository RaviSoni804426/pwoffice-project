const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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
const { pool } = require('./db');

// Healthcheck Endpoint
app.get('/api/health', async (req, res) => {
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: { status: 'unknown' },
    documentServer: { status: 'unknown' }
  };

  let isHealthy = true;

  // 1. Check database pool connectivity
  try {
    const dbRes = await pool.query('SELECT 1');
    if (dbRes.rows) {
      healthStatus.database.status = 'connected';
    } else {
      isHealthy = false;
      healthStatus.database.status = 'disconnected';
    }
  } catch (err) {
    isHealthy = false;
    healthStatus.database.status = 'error';
    healthStatus.database.error = err.message;
  }

  // 2. Check Document Server status
  const docServerUrl = process.env.DOCUMENT_SERVER_PUBLIC_URL || 'http://localhost';
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

// 404 Route
app.use((req, res) => {
  res.status(404).render('landing', { error: 'Page not found.' });
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
