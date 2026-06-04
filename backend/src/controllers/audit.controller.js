const { query } = require('../database/db');
const { writeAuditLog } = require('../utils/audit');
const { verifyAuditChain } = require('../utils/audit');
const { logger } = require('../utils/logger');

/**
 * Get audit logs for the authenticated user's activities.
 */
async function getMyAuditLogs(req, res) {
  const { limit = 50, offset = 0, eventType, from, to } = req.query;

  try {
    let baseQuery = `
      SELECT event_id, event_type, event_category, severity, actor_type,
             target_resource_type, vendor_id, ip_address, event_details,
             outcome, risk_score, created_at
      FROM audit_logs
      WHERE actor_id = $1
    `;
    const params = [req.user.userId];
    let idx = 2;

    if (eventType) { baseQuery += ` AND event_type = $${idx++}`; params.push(eventType); }
    if (from) { baseQuery += ` AND created_at >= $${idx++}`; params.push(from); }
    if (to) { baseQuery += ` AND created_at <= $${idx++}`; params.push(to); }

    baseQuery += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 100), parseInt(offset));

    const result = await query(baseQuery, params);
    return res.json({ logs: result.rows, returned: result.rows.length });
  } catch (err) {
    logger.error(`getMyAuditLogs error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}

/**
 * Admin: Get all audit logs with filters.
 */
async function getAllAuditLogs(req, res) {
  const { limit = 100, offset = 0, severity, eventCategory, vendorId, outcome, from, to } = req.query;

  try {
    let baseQuery = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];
    let idx = 1;

    if (severity) { baseQuery += ` AND severity = $${idx++}`; params.push(severity); }
    if (eventCategory) { baseQuery += ` AND event_category = $${idx++}`; params.push(eventCategory); }
    if (vendorId) { baseQuery += ` AND vendor_id = $${idx++}`; params.push(vendorId); }
    if (outcome) { baseQuery += ` AND outcome = $${idx++}`; params.push(outcome); }
    if (from) { baseQuery += ` AND created_at >= $${idx++}`; params.push(from); }
    if (to) { baseQuery += ` AND created_at <= $${idx++}`; params.push(to); }

    baseQuery += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Math.min(parseInt(limit), 500), parseInt(offset));

    const result = await query(baseQuery, params);
    return res.json({ logs: result.rows, returned: result.rows.length });
  } catch (err) {
    logger.error(`getAllAuditLogs error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}

/**
 * Admin: Verify integrity of audit chain (tamper detection).
 */
async function verifyIntegrity(req, res) {
  try {
    const { limit = 1000 } = req.query;
    const result = await verifyAuditChain(parseInt(limit));
    return res.json({
      integrityValid: result.valid,
      brokenAt: result.brokenAt,
      message: result.valid ? 'Audit chain integrity verified' : 'INTEGRITY VIOLATION DETECTED',
    });
  } catch (err) {
    logger.error(`verifyIntegrity error: ${err.message}`);
    return res.status(500).json({ error: 'Integrity check failed' });
  }
}

/**
 * Get security alerts (Admin only).
 */
async function getSecurityAlerts(req, res) {
  const { acknowledged, severity, limit = 50 } = req.query;

  try {
    let baseQuery = 'SELECT * FROM security_alerts WHERE 1=1';
    const params = [];
    let idx = 1;

    if (acknowledged !== undefined) { baseQuery += ` AND is_acknowledged = $${idx++}`; params.push(acknowledged === 'true'); }
    if (severity) { baseQuery += ` AND severity = $${idx++}`; params.push(severity); }

    baseQuery += ` ORDER BY created_at DESC LIMIT $${idx++}`;
    params.push(Math.min(parseInt(limit), 200));

    const result = await query(baseQuery, params);
    return res.json({ alerts: result.rows });
  } catch (err) {
    logger.error(`getSecurityAlerts error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch security alerts' });
  }
}

module.exports = { getMyAuditLogs, getAllAuditLogs, verifyIntegrity, getSecurityAlerts };
