const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { query } = require('../db');
const { requireNoAuth } = require('../middleware/auth');

// Brute-force protection: max 15 auth attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  },
  handler: (req, res, next, options) => {
    res.status(options.statusCode).render(
      req.path.includes('signup') ? 'signup' : 'login',
      { error: options.message.error, message: null }
    );
  }
});

// GET Signup Page
router.get('/signup', requireNoAuth, (req, res) => {
  res.render('signup', { error: null });
});

// POST Signup Action
router.post('/signup', requireNoAuth, authLimiter, async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (!name || !email || !password || !confirmPassword) {
    return res.render('signup', { error: 'All fields are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.render('signup', { error: 'Please enter a valid email address.' });
  }

  if (password.length < 8) {
    return res.render('signup', { error: 'Password must be at least 8 characters long.' });
  }

  if (password !== confirmPassword) {
    return res.render('signup', { error: 'Passwords do not match.' });
  }

  const cleanName = name.replace(/<[^>]*>/g, '').trim();
  if (!cleanName) {
    return res.render('signup', { error: 'Please enter a valid name.' });
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

    // Save user as verified directly
    await query.run(
      'INSERT INTO users (name, email, password_hash, is_verified, verification_token) VALUES (?, ?, ?, TRUE, NULL)',
      [cleanName, email.toLowerCase().trim(), passwordHash]
    );

    res.redirect('/login?registered=true');
  } catch (err) {
    console.error('Signup error:', err);
    res.render('signup', { error: 'An unexpected error occurred. Please try again.' });
  }
});

// GET Email Verification
router.get('/verify-email', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.render('login', { error: 'Verification token is missing.', message: null });
  }

  try {
    const user = await query.get('SELECT id FROM users WHERE verification_token = ?', [token]);
    if (!user) {
      return res.render('login', { error: 'Invalid or expired verification token.', message: null });
    }

    // Verify user and clear token
    await query.run(
      'UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE id = ?',
      [user.id]
    );

    res.redirect('/login?verified=true');
  } catch (err) {
    console.error('Verification error:', err);
    res.render('login', { error: 'Verification failed. Please try again.', message: null });
  }
});

// GET Login Page
router.get('/login', requireNoAuth, (req, res) => {
  let message = null;
  if (req.query.registered) {
    message = 'Registration successful! You can now log in.';
  } else if (req.query.verified) {
    message = 'Email verified successfully! You can now log in.';
  } else if (req.query.resetSuccess) {
    message = 'Password reset successfully! You can now log in.';
  }
  res.render('login', { error: null, message });
});

// POST Login Action
router.post('/login', requireNoAuth, authLimiter, async (req, res) => {
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

    // Force email verification check (except for migrated users who are verified by default)
    if (!user.is_verified) {
      return res.render('login', {
        error: 'Please verify your email address. A verification link was printed to the server logs.',
        message: null
      });
    }

    // Create JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set cookie with sameSite: strict
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false, // Set to true if running on HTTPS
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.redirect('/workspaces');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'An unexpected error occurred. Please try again.', message: null });
  }
});

// GET Forgot Password
router.get('/forgot-password', requireNoAuth, (req, res) => {
  res.render('forgot-password', { error: null, message: null });
});

// POST Forgot Password Request
router.post('/forgot-password', requireNoAuth, authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.render('forgot-password', { error: 'Email is required.', message: null });
  }

  try {
    const user = await query.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 3600000); // 1 hour

      await query.run(
        'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
        [resetToken, resetExpires, user.id]
      );

      // Simulate sending password reset email via server logs
      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`;
      console.log(`\n==================================================`);
      console.log(`[SIMULATED EMAIL] Password reset email sent to: ${email}`);
      console.log(`Reset Link: ${resetUrl}`);
      console.log(`==================================================\n`);
    }

    // Always show a generic success message to prevent user enumeration attacks
    res.render('forgot-password', {
      error: null,
      message: 'If the email exists, a password reset link has been printed to the server logs.'
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.render('forgot-password', { error: 'An error occurred. Please try again.', message: null });
  }
});

// GET Reset Password
router.get('/reset-password', requireNoAuth, async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.redirect('/login');
  }

  try {
    const user = await query.get(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > CURRENT_TIMESTAMP',
      [token]
    );
    if (!user) {
      return res.render('login', { error: 'Invalid or expired password reset token.', message: null });
    }

    res.render('reset-password', { error: null, token });
  } catch (err) {
    console.error('GET Reset password error:', err);
    res.redirect('/login');
  }
});

// POST Reset Password Action
router.post('/reset-password', requireNoAuth, authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.redirect('/login');
  }

  if (password.length < 8) {
    return res.render('reset-password', { error: 'Password must be at least 8 characters long.', token });
  }

  try {
    const user = await query.get(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > CURRENT_TIMESTAMP',
      [token]
    );
    if (!user) {
      return res.render('login', { error: 'Invalid or expired password reset token.', message: null });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Update password and clear reset token
    await query.run(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [passwordHash, user.id]
    );

    res.redirect('/login?resetSuccess=true');
  } catch (err) {
    console.error('POST Reset password error:', err);
    res.render('reset-password', { error: 'Failed to reset password. Please try again.', token });
  }
});

// GET & POST Logout
router.all('/logout', async (req, res) => {
  const token = req.cookies.auth_token;
  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(decoded.exp * 1000);
        await query.run(
          'INSERT INTO token_blacklist (token_hash, expires_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
          [tokenHash, expiresAt]
        );
      }
    } catch (err) {
      console.error('Error blacklisting token on logout:', err);
    }
  }
  res.clearCookie('auth_token');
  res.redirect('/');
});

module.exports = router;
