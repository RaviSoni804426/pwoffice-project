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

// Global Middleware to load user from JWT cookie if it exists
app.use((req, res, next) => {
  const token = req.cookies.auth_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      res.locals.user = decoded;
    } catch (err) {
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
