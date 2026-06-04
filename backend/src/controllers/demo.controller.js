/**
 * Demo-only controller — available only in non-production environments.
 * Allows the vendor demo portal to simulate patient approve/deny actions
 * without the patient having to manually switch to the patient app.
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const { signToken } = require('../utils/crypto');
const { writeAuditLog } = require('../utils/audit');
const { logger } = require('../utils/logger');

/**
 * POST /api/v1/demo/patient-action
 * Body: { requestRef, action: 'approve'|'deny', patientEmail, patientPassword, denyReason? }
 * Auth: vendor API key (header x-api-key)
 *
 * Authenticates the patient server-side (skips MFA for demo), then approves or denies
 * the consent request on their behalf.
 */
async function patientAction(req, res) {
  const { requestRef, action, patientEmail, patientPassword, denyReason } = req.body;

  if (!requestRef || !action || !patientEmail || !patientPassword) {
    return res.status(400).json({ error: 'requestRef, action, patientEmail and patientPassword are required' });
  }
  if (!['approve', 'deny'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "deny"' });
  }

  try {
    // 1. Authenticate patient
    const userResult = await query(
      'SELECT id, health_id, full_name, password_hash, is_active, locked_until FROM users WHERE email = $1',
      [patientEmail]
    );
    if (!userResult.rows.length) {
      return res.status(401).json({ error: 'Invalid patient credentials' });
    }
    const user = userResult.rows[0];
    const isLocked = user.locked_until && new Date(user.locked_until) > new Date();
    if (!user.is_active || isLocked) {
      return res.status(401).json({ error: 'Patient account is not active or is locked' });
    }
    const passwordOk = await bcrypt.compare(patientPassword, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid patient credentials' });
    }

    // 2. Find the consent request
    const reqResult = await query(
      `SELECT cr.*, v.name AS vendor_name
       FROM consent_requests cr
       JOIN vendors v ON cr.requesting_vendor_id = v.id
       WHERE (cr.request_ref = $1 OR cr.id = $1) AND cr.user_id = $2`,
      [requestRef, user.id]
    );
    if (!reqResult.rows.length) {
      return res.status(404).json({ error: 'Consent request not found for this patient' });
    }
    const consentReq = reqResult.rows[0];

    if (consentReq.status !== 'PENDING') {
      return res.status(400).json({ error: `Request is already ${consentReq.status}` });
    }
    if (new Date(consentReq.expires_at) < new Date()) {
      await query('UPDATE consent_requests SET status = $1 WHERE id = $2', ['EXPIRED', consentReq.id]);
      return res.status(400).json({ error: 'Consent request has expired' });
    }

    if (action === 'deny') {
      // 3a. Deny
      await query(
        "UPDATE consent_requests SET status = 'DENIED', responded_at = datetime('now') WHERE id = $1",
        [consentReq.id]
      );
      await writeAuditLog({
        eventType: 'CONSENT_DENIED', eventCategory: 'CONSENT',
        actorType: 'USER', actorId: user.id, actorHealthId: user.health_id,
        targetResourceType: 'CONSENT_REQUEST', targetResourceId: consentReq.id,
        vendorId: consentReq.requesting_vendor_id,
        eventDetails: { requestRef, reason: denyReason || 'Denied via demo portal' },
        outcome: 'SUCCESS',
      });
      logger.info(`[DEMO] Consent DENIED by patient ${user.health_id} for ${requestRef}`);
      return res.json({ message: 'Consent request denied', requestRef, status: 'DENIED' });
    }

    // 3b. Approve — issue consent token
    const dataTypes = consentReq.requested_data_types;
    const tokenRef = `CT-${Date.now()}-${uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()}`;
    const validFrom = new Date();
    const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const sigPayload = `${tokenRef}:${user.id}:${consentReq.requesting_vendor_id}:${consentReq.purpose}:${validUntil.toISOString()}`;
    const digitalSignature = signToken(sigPayload);

    await query(
      `INSERT INTO consent_tokens
        (id, token_ref, consent_request_id, user_id, vendor_id, purpose, allowed_record_types,
         valid_from, valid_until, digital_signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [uuidv4(), tokenRef, consentReq.id, user.id, consentReq.requesting_vendor_id,
       consentReq.purpose, dataTypes, validFrom, validUntil, digitalSignature]
    );

    await query(
      "UPDATE consent_requests SET status = 'APPROVED', responded_at = datetime('now') WHERE id = $1",
      [consentReq.id]
    );

    await writeAuditLog({
      eventType: 'CONSENT_GRANTED', eventCategory: 'CONSENT',
      actorType: 'USER', actorId: user.id, actorHealthId: user.health_id,
      targetResourceType: 'CONSENT_REQUEST', targetResourceId: consentReq.id,
      vendorId: consentReq.requesting_vendor_id,
      eventDetails: { tokenRef, purpose: consentReq.purpose, dataTypes, validUntil },
      outcome: 'SUCCESS',
    });

    logger.info(`[DEMO] Consent APPROVED by patient ${user.health_id} for ${requestRef}, token: ${tokenRef}`);

    return res.json({
      message: 'Consent approved and token issued',
      requestRef,
      requestId: consentReq.id,
      status: 'APPROVED',
      tokenRef,
      allowedDataTypes: dataTypes,
      validFrom,
      validUntil,
      vendorName: consentReq.vendor_name,
    });

  } catch (err) {
    logger.error(`[DEMO] patientAction error: ${err.message}`);
    return res.status(500).json({ error: 'Demo action failed: ' + err.message });
  }
}

module.exports = { patientAction };
