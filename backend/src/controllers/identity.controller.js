const { query } = require('../database/db');
const { writeAuditLog } = require('../utils/audit');
const { logger } = require('../utils/logger');

/**
 * Get current user's identity profile and health ID details.
 */
async function getMyIdentity(req, res) {
  try {
    const result = await query(
      `SELECT id, health_id, full_name, date_of_birth, gender, phone, email,
              mfa_enabled, is_verified, created_at, last_login
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    return res.json({ identity: result.rows[0] });
  } catch (err) {
    logger.error(`getMyIdentity error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch identity' });
  }
}

/**
 * Lookup a user by Health ID (for vendor use after consent verification).
 * Returns minimal profile - full data requires active consent token.
 */
async function lookupByHealthId(req, res) {
  const { healthId } = req.params;

  try {
    const result = await query(
      'SELECT id, health_id, full_name, gender FROM users WHERE health_id = $1 AND is_active = TRUE',
      [healthId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Health ID not found' });
    }

    await writeAuditLog({
      eventType: 'HEALTH_ID_LOOKUP', eventCategory: 'DATA',
      actorType: 'VENDOR', vendorId: req.vendor?.id,
      targetResourceType: 'USER', targetResourceId: result.rows[0].id,
      ipAddress: req.ip, outcome: 'SUCCESS',
    });

    return res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error(`lookupByHealthId error: ${err.message}`);
    return res.status(500).json({ error: 'Lookup failed' });
  }
}

/**
 * Update user profile (non-sensitive fields).
 */
async function updateProfile(req, res) {
  const { fullName, email } = req.body;
  const userId = req.user.userId;

  try {
    if (email) {
      const dup = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
      if (dup.rows.length > 0) return res.status(409).json({ error: 'Email already in use' });
    }

    const result = await query(
      'UPDATE users SET full_name = COALESCE($1, full_name), email = COALESCE($2, email) WHERE id = $3 RETURNING health_id, full_name, email',
      [fullName, email, userId]
    );

    await writeAuditLog({
      eventType: 'PROFILE_UPDATED', eventCategory: 'DATA',
      actorType: 'USER', actorId: userId, actorHealthId: req.user.healthId,
      ipAddress: req.ip, outcome: 'SUCCESS',
    });

    return res.json({ message: 'Profile updated', user: result.rows[0] });
  } catch (err) {
    logger.error(`updateProfile error: ${err.message}`);
    return res.status(500).json({ error: 'Profile update failed' });
  }
}

/**
 * Get all vendors a user has active consent relationships with.
 */
async function getMyVendorRelationships(req, res) {
  try {
    const result = await query(
      `SELECT DISTINCT v.id, v.name, v.vendor_type, v.vendor_code,
              COUNT(ct.id) FILTER (WHERE ct.is_revoked = FALSE AND ct.valid_until > NOW()) AS active_consents
       FROM consent_tokens ct
       JOIN vendors v ON ct.vendor_id = v.id
       WHERE ct.user_id = $1
       GROUP BY v.id, v.name, v.vendor_type, v.vendor_code`,
      [req.user.userId]
    );

    return res.json({ vendors: result.rows });
  } catch (err) {
    logger.error(`getMyVendorRelationships error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch vendor relationships' });
  }
}

module.exports = { getMyIdentity, lookupByHealthId, updateProfile, getMyVendorRelationships };
