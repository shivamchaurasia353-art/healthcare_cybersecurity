const jwt = require('jsonwebtoken');
const { query } = require('../database/db');
const { hashData } = require('../utils/crypto');

/**
 * Middleware: Verify JWT access token.
 * Attaches decoded user payload to req.user.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7);

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Verify user is still active
    const result = await query('SELECT id, health_id, is_active FROM users WHERE id = $1', [decoded.userId]);
    if (!result.rows.length || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Account inactive or not found' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(403).json({ error: 'Invalid access token' });
  }
}

/**
 * Middleware: Verify vendor API key (for vendor-facing endpoints).
 * Attaches vendor info to req.vendor.
 */
async function authenticateVendor(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Vendor API key required' });
  }

  const keyHash = hashData(apiKey);
  const result = await query(
    'SELECT id, vendor_code, name, vendor_type, is_active, is_approved FROM vendors WHERE api_key_hash = $1',
    [keyHash]
  );

  if (!result.rows.length) {
    return res.status(401).json({ error: 'Invalid vendor API key' });
  }

  const vendor = result.rows[0];
  if (!vendor.is_active || !vendor.is_approved) {
    return res.status(403).json({ error: 'Vendor account not approved or inactive' });
  }

  req.vendor = vendor;
  next();
}

/**
 * Middleware: Verify admin JWT token.
 */
async function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7);

  if (!token) return res.status(401).json({ error: 'Admin token required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN' && decoded.role !== 'SUPER_ADMIN' && decoded.role !== 'MODERATOR') {
      return res.status(403).json({ error: 'Insufficient privileges' });
    }
    req.admin = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
}

/**
 * Middleware: Require MFA verified session.
 */
function requireMfaVerified(req, res, next) {
  if (!req.user?.mfaVerified) {
    return res.status(403).json({ error: 'MFA verification required', code: 'MFA_REQUIRED' });
  }
  next();
}

module.exports = { authenticateToken, authenticateVendor, authenticateAdmin, requireMfaVerified };
