const { query } = require('../database/db');
const { hashData, signToken } = require('../utils/crypto');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

/**
 * Writes an immutable audit log entry with chain-hash integrity.
 * Audit logs cannot be updated or deleted (enforced at DB level via rules).
 */
async function writeAuditLog({
  eventType,
  eventCategory,
  severity = 'INFO',
  actorType,
  actorId = null,
  actorHealthId = null,
  targetResourceType = null,
  targetResourceId = null,
  vendorId = null,
  ipAddress = null,
  userAgent = null,
  sessionId = null,
  eventDetails = {},
  outcome,
  riskScore = 0,
}) {
  try {
    // Fetch the last audit entry hash for chain linking
    const lastEntry = await query(
      'SELECT integrity_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1'
    );
    const prevHash = lastEntry.rows.length > 0 ? lastEntry.rows[0].integrity_hash : 'GENESIS';

    const eventId = `EVT-${Date.now()}-${uuidv4().split('-')[0].toUpperCase()}`;

    // Build the payload string for integrity hashing
    const payload = JSON.stringify({
      eventId, eventType, actorId, targetResourceId, outcome, prevHash, ts: new Date().toISOString(),
    });
    const integrityHash = hashData(payload + (process.env.JWT_SECRET || 'fallback'));

    await query(
      `INSERT INTO audit_logs (
        id, event_id, event_type, event_category, severity, actor_type, actor_id,
        actor_health_id, target_resource_type, target_resource_id, vendor_id,
        ip_address, user_agent, session_id, event_details, outcome, risk_score,
        integrity_hash, prev_event_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        uuidv4(), eventId, eventType, eventCategory, severity, actorType, actorId,
        actorHealthId, targetResourceType, targetResourceId, vendorId,
        ipAddress, userAgent, sessionId, JSON.stringify(eventDetails),
        outcome, riskScore, integrityHash, prevHash,
      ]
    );
  } catch (err) {
    // Audit failure should not crash the main request, but must be logged at application level
    logger.error(`Audit log write failed: ${err.message}`);
  }
}

/**
 * Verify integrity of the audit log chain.
 * Returns { valid: boolean, brokenAt: entry | null }
 */
async function verifyAuditChain(limit = 500) {
  const result = await query(
    'SELECT * FROM audit_logs ORDER BY created_at ASC LIMIT $1', [limit]
  );
  const entries = result.rows;
  let prevHash = 'GENESIS';

  for (const entry of entries) {
    if (entry.prev_event_hash !== prevHash) {
      return { valid: false, brokenAt: entry };
    }
    prevHash = entry.integrity_hash;
  }
  return { valid: true, brokenAt: null };
}

module.exports = { writeAuditLog, verifyAuditChain };
