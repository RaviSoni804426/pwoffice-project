const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies.auth_token;

  if (!token) {
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

function requireNoAuth(req, res, next) {
  const token = req.cookies.auth_token;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      res.locals.user = decoded;
      return res.redirect('/workspaces');
    } catch (err) {
      res.clearCookie('auth_token');
    }
  }
  next();
}

module.exports = {
  requireAuth,
  requireNoAuth
};
