const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { requireNoAuth } = require('../middleware/auth');

// GET Signup Page
router.get('/signup', requireNoAuth, (req, res) => {
  res.render('signup', { error: null });
});

// POST Signup Action
router.post('/signup', requireNoAuth, async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.render('signup', { error: 'All fields are required.' });
  }

  try {
    // Check if user already exists
    const existingUser = await query.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existingUser) {
      return res.render('signup', { error: 'Email already registered.' });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Save user
    await query.run(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase().trim(), passwordHash]
    );

    res.redirect('/login?registered=true');
  } catch (err) {
    console.error('Signup error:', err);
    res.render('signup', { error: 'An unexpected error occurred. Please try again.' });
  }
});

// GET Login Page
router.get('/login', requireNoAuth, (req, res) => {
  const message = req.query.registered ? 'Registration successful! Please login.' : null;
  res.render('login', { error: null, message });
});

// POST Login Action
router.post('/login', requireNoAuth, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Email and password are required.', message: null });
  }

  try {
    const user = await query.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.render('login', { error: 'Invalid email or password.', message: null });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.render('login', { error: 'Invalid email or password.', message: null });
    }

    // Create JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false, // Set to true if running on HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.redirect('/workspaces');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'An unexpected error occurred. Please try again.', message: null });
  }
});

// GET Logout
router.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/');
});

module.exports = router;
