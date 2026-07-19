const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db');

async function isTokenBlacklisted(token) {
  if (!token) return false;
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await query.get('SELECT token_hash FROM token_blacklist WHERE token_hash = ?', [tokenHash]);
    return !!result;
  } catch (err) {
    console.error('Error checking blacklisted token:', err);
    return false;
  }
}

async function requireAuth(req, res, next) {
  const token = req.cookies.auth_token;

  if (!token) {
    return res.redirect('/login');
  }

  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    res.clearCookie('auth_token');
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    res.locals.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('auth_token');
    return res.redirect('/login');
  }
}

async function requireNoAuth(req, res, next) {
  const token = req.cookies.auth_token;

  if (token) {
    const blacklisted = await isTokenBlacklisted(token);
    if (!blacklisted) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        res.locals.user = decoded;
        return res.redirect('/workspaces');
      } catch (err) {
        res.clearCookie('auth_token');
      }
    } else {
      res.clearCookie('auth_token');
    }
  }
  next();
}

module.exports = {
  requireAuth,
  requireNoAuth,
  isTokenBlacklisted
};
