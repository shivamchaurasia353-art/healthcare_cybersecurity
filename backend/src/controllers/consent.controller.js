const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const { signToken } = require('../utils/crypto');
const { writeAuditLog } = require('../utils/audit');
const { logger } = require('../utils/logger');

const VALID_PURPOSES = ['TREATMENT', 'DIAGNOSIS', 'INSURANCE_CLAIM', 'RESEARCH', 'EMERGENCY', 'PHARMACY', 'LAB_REVIEW'];
const VALID_RECORD_TYPES = ['PRESCRIPTION', 'LAB_REPORT', 'DISCHARGE_SUMMARY', 'IMAGING', 'VACCINATION', 'INSURANCE', 'CONSULTATION'];

/**
 * Vendor requests consent from a patient by Health ID.
 * Patient receives notification and must approve.
 */
async function requestConsent(req, res) {
  const { healthId, purpose, requestedDataTypes, requestedFrom, requestedTo, urgency, requesterNote } = req.body;
  const vendor = req.vendor;

  if (!VALID_PURPOSES.includes(purpose)) {
    return res.status(400).json({ error: `Invalid purpose. Allowed: ${VALID_PURPOSES.join(', ')}` });
  }

  const invalidTypes = (requestedDataTypes || []).filter(t => !VALID_RECORD_TYPES.includes(t));
  if (invalidTypes.length > 0) {
    return res.status(400).json({ error: `Invalid record types: ${invalidTypes.join(', ')}` });
  }

  try {
    const userResult = await query('SELECT id, health_id FROM users WHERE health_id = $1 AND is_active = TRUE', [healthId]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'Patient Health ID not found' });

    const user = userResult.rows[0];
    const requestRef = `CR-${Date.now()}-${uuidv4().split('-')[0].toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h to respond

    const consentId = uuidv4();
    const result = await query(
      `INSERT INTO consent_requests 
        (id, request_ref, user_id, requesting_vendor_id, purpose, requested_data_types, 
         requested_from, requested_to, urgency, requester_note, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, request_ref, status, created_at`,
      [consentId, requestRef, user.id, vendor.id, purpose, requestedDataTypes, requestedFrom, requestedTo,
       urgency || 'ROUTINE', requesterNote, expiresAt]
    );

    await writeAuditLog({
      eventType: 'CONSENT_REQUEST', eventCategory: 'CONSENT',
      actorType: 'VENDOR', vendorId: vendor.id,
      targetResourceType: 'USER', targetResourceId: user.id,
      eventDetails: { requestRef, purpose, dataTypes: requestedDataTypes },
      outcome: 'SUCCESS',
    });

    return res.status(201).json({
      message: 'Consent request submitted. Patient will be notified.',
      requestRef,
      requestId: result.rows[0].id,
      status: result.rows[0].status,
    });
  } catch (err) {
    logger.error(`requestConsent error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to submit consent request' });
  }
}

/**
 * Patient retrieves their pending consent requests.
 */
async function getMyConsentRequests(req, res) {
  try {
    const result = await query(
      `SELECT cr.id, cr.request_ref, cr.purpose, cr.requested_data_types, cr.urgency,
              cr.requested_from, cr.requested_to, cr.requester_note, cr.status,
              cr.created_at, cr.expires_at, cr.responded_at,
              v.name AS vendor_name, v.vendor_type, v.vendor_code
       FROM consent_requests cr
       JOIN vendors v ON cr.requesting_vendor_id = v.id
       WHERE cr.user_id = $1
       ORDER BY cr.created_at DESC
       LIMIT 50`,
      [req.user.userId]
    );

    return res.json({ requests: result.rows });
  } catch (err) {
    logger.error(`getMyConsentRequests error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch consent requests' });
  }
}

/**
 * Patient approves a consent request.
 * Creates a signed, time-limited consent token.
 */
async function approveConsent(req, res) {
  const { requestId } = req.params;
  const { validUntil, scopeOverride } = req.body; // patient can narrow scope further
  const userId = req.user.userId;

  try {
    const reqResult = await query(
      `SELECT cr.*, v.name AS vendor_name FROM consent_requests cr
       JOIN vendors v ON cr.requesting_vendor_id = v.id
       WHERE cr.id = $1 AND cr.user_id = $2`,
      [requestId, userId]
    );

    if (!reqResult.rows.length) return res.status(404).json({ error: 'Consent request not found' });

    const consentReq = reqResult.rows[0];

    if (consentReq.status !== 'PENDING') {
      return res.status(400).json({ error: `Request is already ${consentReq.status}` });
    }

    if (new Date(consentReq.expires_at) < new Date()) {
      await query('UPDATE consent_requests SET status = $1 WHERE id = $2', ['EXPIRED', requestId]);
      return res.status(400).json({ error: 'Consent request has expired' });
    }

    // Patient can reduce scope but not expand beyond what was requested
    const allowedTypes = scopeOverride
      ? (scopeOverride).filter(t => consentReq.requested_data_types.includes(t))
      : consentReq.requested_data_types;

    if (allowedTypes.length === 0) {
      return res.status(400).json({ error: 'No valid data types in approved scope' });
    }

    const tokenRef = `CT-${Date.now()}-${uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()}`;
    const validFrom = new Date();
    const validUntilDate = validUntil ? new Date(validUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (validUntilDate <= validFrom) {
      return res.status(400).json({ error: 'Validity window must be in the future' });
    }

    // HMAC signature over key consent fields
    const sigPayload = `${tokenRef}:${userId}:${consentReq.requesting_vendor_id}:${consentReq.purpose}:${validUntilDate.toISOString()}`;
    const digitalSignature = signToken(sigPayload);

    const tokenResult = await query(
      `INSERT INTO consent_tokens
        (id, token_ref, consent_request_id, user_id, vendor_id, purpose, allowed_record_types,
         valid_from, valid_until, digital_signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, token_ref, valid_from, valid_until`,
      [uuidv4(), tokenRef, requestId, userId, consentReq.requesting_vendor_id, consentReq.purpose,
       allowedTypes, validFrom, validUntilDate, digitalSignature]
    );

    await query('UPDATE consent_requests SET status = $1, responded_at = NOW() WHERE id = $2', ['APPROVED', requestId]);

    await writeAuditLog({
      eventType: 'CONSENT_GRANTED', eventCategory: 'CONSENT',
      actorType: 'USER', actorId: userId, actorHealthId: req.user.healthId,
      targetResourceType: 'CONSENT_REQUEST', targetResourceId: consentReq.id,
      vendorId: consentReq.requesting_vendor_id,
      eventDetails: { tokenRef, purpose: consentReq.purpose, allowedTypes, validUntil: validUntilDate },
      outcome: 'SUCCESS',
    });

    return res.json({
      message: 'Consent approved and token issued',
      requestId,
      tokenRef,
      allowedDataTypes: allowedTypes,
      validFrom,
      validUntil: validUntilDate,
    });
  } catch (err) {
    logger.error(`approveConsent error: ${err.message}`);
    return res.status(500).json({ error: 'Consent approval failed' });
  }
}

/**
 * Patient denies a consent request.
 */
async function denyConsent(req, res) {
  const { requestId } = req.params;
  const userId = req.user.userId;

  try {
    const result = await query(
      'UPDATE consent_requests SET status = $1, responded_at = NOW() WHERE id = $2 AND user_id = $3 AND status = $4 RETURNING id',
      ['DENIED', requestId, userId, 'PENDING']
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Pending consent request not found' });

    await writeAuditLog({
      eventType: 'CONSENT_DENIED', eventCategory: 'CONSENT',
      actorType: 'USER', actorId: userId, actorHealthId: req.user.healthId,
      targetResourceType: 'CONSENT_REQUEST', targetResourceId: requestId,
      outcome: 'SUCCESS',
    });

    return res.json({ message: 'Consent request denied' });
  } catch (err) {
    logger.error(`denyConsent error: ${err.message}`);
    return res.status(500).json({ error: 'Deny operation failed' });
  }
}

/**
 * Patient revokes an active consent token. Takes effect immediately.
 */
async function revokeConsent(req, res) {
  const { tokenRef } = req.params;
  const { reason } = req.body;
  const userId = req.user.userId;

  try {
    const result = await query(
      `UPDATE consent_tokens SET is_revoked = TRUE, revoked_at = datetime('now'), revocation_reason = $1
       WHERE token_ref = $2 AND user_id = $3 AND is_revoked = FALSE
       RETURNING id, vendor_id, consent_request_id`,
      [reason || 'Revoked by patient', tokenRef, userId]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Active consent token not found' });

    // Also mark the parent request as revoked (SQLite doesn't support UPDATE...FROM)
    await query(
      `UPDATE consent_requests SET status = 'REVOKED' WHERE id = $1`,
      [result.rows[0].consent_request_id]
    );

    await writeAuditLog({
      eventType: 'CONSENT_REVOKED', eventCategory: 'CONSENT', severity: 'WARNING',
      actorType: 'USER', actorId: userId, actorHealthId: req.user.healthId,
      vendorId: result.rows[0].vendor_id,
      eventDetails: { tokenRef, reason },
      outcome: 'SUCCESS', riskScore: 10,
    });

    return res.json({ message: 'Consent revoked immediately. Vendor access terminated.' });
  } catch (err) {
    logger.error(`revokeConsent error: ${err.message}`);
    return res.status(500).json({ error: 'Revocation failed' });
  }
}

/**
 * Get all active consent tokens for the current user.
 */
async function getMyActiveConsents(req, res) {
  try {
    const result = await query(
      `SELECT ct.token_ref, ct.purpose, ct.allowed_record_types, ct.valid_from, ct.valid_until,
              ct.access_count, ct.last_accessed, ct.is_revoked,
              v.name AS vendor_name, v.vendor_type
       FROM consent_tokens ct
       JOIN vendors v ON ct.vendor_id = v.id
       WHERE ct.user_id = $1 AND ct.is_revoked = FALSE AND ct.valid_until > NOW()
       ORDER BY ct.valid_until DESC`,
      [req.user.userId]
    );

    return res.json({ consents: result.rows });
  } catch (err) {
    logger.error(`getMyActiveConsents error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch active consents' });
  }
}

/**
 * Vendor validates a consent token before accessing records.
 */
async function validateConsentToken(req, res) {
  const { tokenRef, dataType } = req.body;
  const vendor = req.vendor;

  try {
    const result = await query(
      `SELECT ct.*, u.health_id, u.full_name
       FROM consent_tokens ct JOIN users u ON ct.user_id = u.id
       WHERE ct.token_ref = $1 AND ct.vendor_id = $2`,
      [tokenRef, vendor.id]
    );

    if (!result.rows.length) {
      await writeAuditLog({
        eventType: 'CONSENT_VALIDATION_FAILURE', eventCategory: 'SECURITY', severity: 'WARNING',
        actorType: 'VENDOR', vendorId: vendor.id,
        eventDetails: { tokenRef, dataType, reason: 'token_not_found' },
        outcome: 'FAILURE', riskScore: 70,
      });
      return res.status(403).json({ valid: false, reason: 'Token not found or not issued to this vendor' });
    }

    const token = result.rows[0];

    if (token.is_revoked) return res.status(403).json({ valid: false, reason: 'Token has been revoked by patient' });
    if (new Date(token.valid_until) < new Date()) return res.status(403).json({ valid: false, reason: 'Token has expired' });
    if (dataType && !token.allowed_record_types.includes(dataType)) {
      return res.status(403).json({ valid: false, reason: `Data type '${dataType}' not in approved scope` });
    }

    // Increment access count
    await query('UPDATE consent_tokens SET access_count = access_count + 1, last_accessed = NOW() WHERE token_ref = $1', [tokenRef]);

    await writeAuditLog({
      eventType: 'CONSENT_VALIDATED', eventCategory: 'CONSENT',
      actorType: 'VENDOR', vendorId: vendor.id,
      targetResourceType: 'USER', targetResourceId: token.user_id,
      eventDetails: { tokenRef, dataType, purpose: token.purpose },
      outcome: 'SUCCESS',
    });

    return res.json({
      valid: true,
      purpose: token.purpose,
      allowedDataTypes: token.allowed_record_types,
      validUntil: token.valid_until,
      patientHealthId: token.health_id,
      patientName: token.full_name,
    });
  } catch (err) {
    logger.error(`validateConsentToken error: ${err.message}`);
    return res.status(500).json({ error: 'Token validation failed' });
  }
}

/**
 * Vendor checks the status of a consent request by its reference.
 * Used for polling after submission.
 */
async function getRequestStatusByRef(req, res) {
  const { requestRef } = req.params;
  const vendor = req.vendor;

  try {
    const result = await query(
      `SELECT cr.id, cr.request_ref, cr.status, cr.responded_at, cr.expires_at,
              cr.purpose, cr.requested_data_types, cr.urgency
       FROM consent_requests cr
       WHERE cr.request_ref = $1 AND cr.requesting_vendor_id = $2`,
      [requestRef, vendor.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Request not found or not owned by this vendor' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    logger.error(`getRequestStatusByRef error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch request status' });
  }
}

/**
 * Vendor retrieves the consent token for an approved request by request ID.
 * The vendor can then use this token to access records.
 */
async function getTokenForApprovedRequest(req, res) {
  const { requestId } = req.params;
  const vendor = req.vendor;

  try {
    // Accept either UUID (cr.id) or request_ref (CR-...)
    const result = await query(
      `SELECT ct.token_ref, ct.purpose, ct.allowed_record_types,
              ct.valid_from, ct.valid_until, ct.access_count
       FROM consent_tokens ct
       JOIN consent_requests cr ON ct.consent_request_id = cr.id
       WHERE (cr.id = $1 OR cr.request_ref = $1) AND ct.vendor_id = $2
         AND ct.is_revoked = FALSE AND ct.valid_until > datetime('now')`,
      [requestId, vendor.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'No active consent token found for this request. Patient may not have approved yet.' });
    }

    const token = result.rows[0];
    return res.json({
      tokenRef: token.token_ref,
      purpose: token.purpose,
      allowedDataTypes: token.allowed_record_types,
      validFrom: token.valid_from,
      expiresAt: token.valid_until,
      accessCount: token.access_count,
    });
  } catch (err) {
    logger.error(`getTokenForApprovedRequest error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to retrieve consent token' });
  }
}

module.exports = {
  requestConsent, getMyConsentRequests, approveConsent, denyConsent,
  revokeConsent, getMyActiveConsents, validateConsentToken,
  getRequestStatusByRef, getTokenForApprovedRequest,
};
