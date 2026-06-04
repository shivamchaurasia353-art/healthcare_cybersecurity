const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const { encrypt, decrypt, hashData } = require('../utils/crypto');
const { writeAuditLog } = require('../utils/audit');
const { logger } = require('../utils/logger');

/**
 * Create a new health record (uploaded by an approved vendor).
 */
async function createRecord(req, res) {
  const { healthId, recordType, recordCategory, title, description, data, recordDate, tags, isSensitive } = req.body;
  const vendor = req.vendor;

  try {
    const userResult = await query('SELECT id, health_id FROM users WHERE health_id = $1', [healthId]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'Patient not found' });

    const user = userResult.rows[0];
    const dataString = typeof data === 'object' ? JSON.stringify(data) : String(data);
    const dataEncrypted = encrypt(dataString);
    const dataHash = hashData(dataString);

    const result = await query(
      `INSERT INTO health_records 
        (id, user_id, vendor_id, record_type, record_category, title, description, 
         data_encrypted, data_hash, record_date, tags, is_sensitive, created_by_vendor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, record_type, title, created_at`,
      [uuidv4(), user.id, vendor.id, recordType, recordCategory, title, description,
       dataEncrypted, dataHash, recordDate, tags || [], isSensitive || false, vendor.id]
    );

    await writeAuditLog({
      eventType: 'RECORD_CREATED', eventCategory: 'DATA',
      actorType: 'VENDOR', vendorId: vendor.id,
      targetResourceType: 'HEALTH_RECORD', targetResourceId: result.rows[0].id,
      eventDetails: { recordType, title, patientHealthId: healthId },
      outcome: 'SUCCESS',
    });

    return res.status(201).json({ message: 'Health record created', record: result.rows[0] });
  } catch (err) {
    logger.error(`createRecord error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to create record' });
  }
}

/**
 * Patient retrieves their own health records (all or filtered).
 */
async function getMyRecords(req, res) {
  const { recordType, vendorId, from, to } = req.query;
  const userId = req.user.userId;

  try {
    let baseQuery = `
      SELECT hr.id, hr.record_type, hr.record_category, hr.title, hr.description,
             hr.record_date, hr.tags, hr.is_sensitive, hr.created_at,
             hr.data_encrypted, hr.data_hash,
             v.name AS vendor_name, v.vendor_type
      FROM health_records hr
      JOIN vendors v ON hr.vendor_id = v.id
      WHERE hr.user_id = $1 AND hr.is_active = TRUE
    `;
    const params = [userId];
    let idx = 2;

    if (recordType) { baseQuery += ` AND hr.record_type = $${idx++}`; params.push(recordType); }
    if (vendorId) { baseQuery += ` AND hr.vendor_id = $${idx++}`; params.push(vendorId); }
    if (from) { baseQuery += ` AND hr.record_date >= $${idx++}`; params.push(from); }
    if (to) { baseQuery += ` AND hr.record_date <= $${idx++}`; params.push(to); }

    baseQuery += ' ORDER BY hr.record_date DESC LIMIT 100';

    const result = await query(baseQuery, params);
    const records = result.rows.map(r => {
      let data = null;
      try { data = JSON.parse(decrypt(r.data_encrypted)); } catch (_) {}
      const { data_encrypted, data_hash, ...rest } = r;
      return { ...rest, data };
    });
    return res.json({ records, total: records.length });
  } catch (err) {
    logger.error(`getMyRecords error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch records' });
  }
}

/**
 * Patient retrieves a specific record with decrypted data.
 */
async function getRecordById(req, res) {
  const { recordId } = req.params;
  const userId = req.user.userId;

  try {
    const result = await query(
      `SELECT hr.*, v.name AS vendor_name, v.vendor_type FROM health_records hr
       JOIN vendors v ON hr.vendor_id = v.id
       WHERE hr.id = $1 AND hr.user_id = $2 AND hr.is_active = TRUE`,
      [recordId, userId]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Record not found' });

    const record = result.rows[0];
    const decryptedData = decrypt(record.data_encrypted);

    // Integrity check
    const currentHash = hashData(decryptedData);
    const integrityOk = currentHash === record.data_hash;

    await writeAuditLog({
      eventType: 'RECORD_VIEWED', eventCategory: 'DATA',
      actorType: 'USER', actorId: userId, actorHealthId: req.user.healthId,
      targetResourceType: 'HEALTH_RECORD', targetResourceId: record.id,
      eventDetails: { recordType: record.record_type, integrityOk },
      outcome: 'SUCCESS',
    });

    return res.json({
      record: { ...record, data: JSON.parse(decryptedData), data_encrypted: undefined },
      integrityVerified: integrityOk,
    });
  } catch (err) {
    logger.error(`getRecordById error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch record' });
  }
}

/**
 * Vendor accesses patient records using a valid consent token.
 * This enforces the consent boundary - vendor only sees approved data types.
 */
async function vendorAccessRecords(req, res) {
  const { tokenRef: rawRef, consentToken, healthId, recordType } = req.body;
  const tokenRef = rawRef || consentToken; // Accept both field names
  const vendor = req.vendor;

  try {
    // Validate consent token
    const tokenResult = await query(
      `SELECT ct.* FROM consent_tokens ct
       WHERE ct.token_ref = $1 AND ct.vendor_id = $2
         AND ct.is_revoked = FALSE AND ct.valid_until > datetime('now')`,
      [tokenRef, vendor.id]
    );

    if (!tokenResult.rows.length) {
      await writeAuditLog({
        eventType: 'UNAUTHORIZED_DATA_ACCESS', eventCategory: 'SECURITY', severity: 'CRITICAL',
        actorType: 'VENDOR', vendorId: vendor.id,
        eventDetails: { tokenRef, reason: 'invalid_token' },
        outcome: 'BLOCKED', riskScore: 90,
      });
      return res.status(403).json({ error: 'Invalid, expired, or revoked consent token' });
    }

    const token = tokenResult.rows[0];

    // Verify the requested data type is in allowed scope
    if (recordType && !token.allowed_record_types.includes(recordType)) {
      await writeAuditLog({
        eventType: 'OUT_OF_SCOPE_ACCESS', eventCategory: 'SECURITY', severity: 'CRITICAL',
        actorType: 'VENDOR', vendorId: vendor.id,
        targetResourceType: 'USER', targetResourceId: token.user_id,
        eventDetails: { requestedType: recordType, allowedTypes: token.allowed_record_types },
        outcome: 'BLOCKED', riskScore: 85,
      });
      return res.status(403).json({ error: `Data type '${recordType}' is not in the consent scope` });
    }

    // Fetch only records matching the consent scope
    const allowedTypes = recordType ? [recordType] : token.allowed_record_types;
    const result = await query(
      `SELECT hr.id, hr.record_type, hr.record_category, hr.title, hr.description,
              hr.data_encrypted, hr.data_hash, hr.record_date, hr.tags,
              v.name AS vendor_name, v.vendor_type
       FROM health_records hr
       JOIN vendors v ON hr.vendor_id = v.id
       WHERE hr.user_id = $1 AND hr.record_type = ANY($2) AND hr.is_active = TRUE
       ORDER BY hr.record_date DESC LIMIT 50`,
      [token.user_id, allowedTypes]
    );

    // Decrypt each record and verify integrity
    const records = result.rows.map(r => {
      const decrypted = decrypt(r.data_encrypted);
      const integrityOk = hashData(decrypted) === r.data_hash;
      return {
        id: r.id, record_type: r.record_type, title: r.title,
        description: r.description, record_date: r.record_date, tags: r.tags,
        vendor_name: r.vendor_name, vendor_type: r.vendor_type,
        data: JSON.parse(decrypted), integrity_verified: integrityOk,
      };
    });

    // Update access tracking
    await query(`UPDATE consent_tokens SET access_count = access_count + 1, last_accessed = datetime('now') WHERE token_ref = $1`, [tokenRef]);

    await writeAuditLog({
      eventType: 'VENDOR_DATA_ACCESS', eventCategory: 'DATA',
      actorType: 'VENDOR', vendorId: vendor.id,
      targetResourceType: 'USER', targetResourceId: token.user_id,
      eventDetails: { tokenRef, purpose: token.purpose, recordCount: records.length, recordTypes: allowedTypes },
      outcome: 'SUCCESS',
    });

    return res.json({
      records,
      consentScope: { purpose: token.purpose, allowedTypes: token.allowed_record_types, validUntil: token.valid_until },
    });
  } catch (err) {
    logger.error(`vendorAccessRecords error: ${err.message}`);
    return res.status(500).json({ error: 'Data access failed' });
  }
}

/**
 * Patient uploads their own health record (self-submitted document).
 * Uses the SELF_UPLOAD system vendor.
 */
async function uploadMyRecord(req, res) {
  const { recordType, recordCategory, title, description, data, recordDate, tags, isSensitive } = req.body;
  const userId = req.user.userId;

  const VALID_TYPES = ['PRESCRIPTION', 'LAB_REPORT', 'DISCHARGE_SUMMARY', 'IMAGING', 'VACCINATION', 'INSURANCE', 'CONSULTATION'];
  const VALID_CATS = ['CLINICAL', 'DIAGNOSTIC', 'ADMINISTRATIVE', 'FINANCIAL'];

  if (!recordType || !VALID_TYPES.includes(recordType)) {
    return res.status(400).json({ error: `Invalid record type. Allowed: ${VALID_TYPES.join(', ')}` });
  }
  if (!title || !recordDate) {
    return res.status(400).json({ error: 'title and recordDate are required' });
  }

  try {
    // Get SELF_UPLOAD system vendor
    const vendorResult = await query("SELECT id FROM vendors WHERE vendor_code = 'SELF_UPLOAD' LIMIT 1");
    if (!vendorResult.rows.length) {
      return res.status(503).json({ error: 'Self-upload service not configured. Run the seed script first.' });
    }
    const selfVendorId = vendorResult.rows[0].id;

    const dataObj = data || { note: description || 'Patient self-uploaded record' };
    const dataString = typeof dataObj === 'object' ? JSON.stringify(dataObj) : String(dataObj);
    const dataEncrypted = encrypt(dataString);
    const dataHash = hashData(dataString);

    const result = await query(
      `INSERT INTO health_records
        (id, user_id, vendor_id, record_type, record_category, title, description,
         data_encrypted, data_hash, record_date, tags, is_sensitive, created_by_vendor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, record_type, title, created_at`,
      [uuidv4(), userId, selfVendorId, recordType, recordCategory || 'CLINICAL',
       title, description, dataEncrypted, dataHash,
       recordDate, tags || [], isSensitive || false, selfVendorId]
    );

    await writeAuditLog({
      eventType: 'RECORD_SELF_UPLOADED', eventCategory: 'DATA',
      actorType: 'USER', actorId: userId, actorHealthId: req.user.healthId,
      targetResourceType: 'HEALTH_RECORD', targetResourceId: result.rows[0].id,
      eventDetails: { recordType, title },
      outcome: 'SUCCESS',
    });

    return res.status(201).json({ message: 'Record uploaded successfully', record: result.rows[0] });
  } catch (err) {
    logger.error(`uploadMyRecord error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to upload record' });
  }
}

/**
 * Seed sample health records for the logged-in patient.
 * Idempotent — skips any record type the user already has ≥1 of.
 */
async function seedMyRecords(req, res) {
  const userId = req.user.userId;

  try {
    // Get vendor IDs — fall back to SELF_UPLOAD if named vendors don't exist
    const vendors = await query(
      `SELECT id, vendor_code FROM vendors WHERE vendor_code IN ('APOLLO_HYD', 'CITYLAB_HYD', 'MEDPLUS_HYD', 'SELF_UPLOAD')`
    );
    const byCode = Object.fromEntries(vendors.rows.map(v => [v.vendor_code, v.id]));
    const fallback = byCode['SELF_UPLOAD'] || vendors.rows[0]?.id;
    const apollo = byCode['APOLLO_HYD'] || fallback;
    const citylab = byCode['CITYLAB_HYD'] || fallback;
    const medplus = byCode['MEDPLUS_HYD'] || fallback;
    const self = byCode['SELF_UPLOAD'] || fallback;

    if (!fallback) return res.status(503).json({ error: 'No vendors found. Run the seed script first.' });

    const samples = [
      { vendorId: apollo, record_type: 'PRESCRIPTION', record_category: 'CLINICAL',
        title: 'Amoxicillin + Ibuprofen Prescription',
        description: 'Post-operative antibiotic and pain relief course for 7 days',
        data: { medications: ['Amoxicillin 500mg 3x/day', 'Ibuprofen 400mg 2x/day'], instructions: 'Take after food', doctor: 'Dr. Anand Reddy', specialization: 'General Surgery',
          attachments: [{ name: 'prescription_amoxicillin_20260520.pdf', type: 'application/pdf', size: '124 KB', note: 'Signed prescription document' }] },
        record_date: '2026-05-20', tags: ['antibiotics', 'post-op'], is_sensitive: false },
      { vendorId: citylab, record_type: 'LAB_REPORT', record_category: 'DIAGNOSTIC',
        title: 'Complete Blood Count (CBC) Report',
        description: 'Routine blood work — all parameters within normal range',
        data: { hemoglobin: '14.2 g/dL', WBC: '7200 /μL', platelets: '2.4 lakh /μL', RBC: '4.8 million/μL', result: 'NORMAL',
          attachments: [{ name: 'CBC_report_CityLab_20260515.pdf', type: 'application/pdf', size: '89 KB', note: 'Laboratory certified report' }] },
        record_date: '2026-05-15', tags: ['blood-test', 'CBC'], is_sensitive: false },
      { vendorId: citylab, record_type: 'LAB_REPORT', record_category: 'DIAGNOSTIC',
        title: 'Lipid Profile Report',
        description: 'Annual cardiac risk assessment — LDL borderline high',
        data: { totalCholesterol: '198 mg/dL', LDL: '138 mg/dL', HDL: '48 mg/dL', triglycerides: '165 mg/dL', risk: 'MODERATE',
          attachments: [{ name: 'lipid_profile_CityLab_20260410.pdf', type: 'application/pdf', size: '76 KB', note: 'Includes reference range chart' }] },
        record_date: '2026-04-10', tags: ['cholesterol', 'cardiac'], is_sensitive: false },
      { vendorId: apollo, record_type: 'DISCHARGE_SUMMARY', record_category: 'CLINICAL',
        title: 'Appendectomy Discharge Summary',
        description: 'Laparoscopic appendectomy — successful. Discharged after 3 days.',
        data: { procedure: 'Laparoscopic Appendectomy', surgeon: 'Dr. Sunita Rao', admitDate: '2026-05-17', dischargeDate: '2026-05-20', diagnosis: 'Acute Appendicitis',
          attachments: [
            { name: 'discharge_summary_Apollo_20260520.pdf', type: 'application/pdf', size: '215 KB', note: 'Full discharge summary with instructions' },
            { name: 'operation_notes_20260517.pdf', type: 'application/pdf', size: '98 KB', note: 'Surgeon operation notes' }
          ] },
        record_date: '2026-05-20', tags: ['surgery', 'appendectomy', 'inpatient'], is_sensitive: false },
      { vendorId: apollo, record_type: 'VACCINATION', record_category: 'CLINICAL',
        title: 'COVID-19 Booster (Covaxin)',
        description: 'Third dose booster — administered at Apollo Vaccination Centre',
        data: { vaccine: 'Covaxin (BBV152)', dose: 'Booster (3rd)', batchNo: 'CVX2026-B47', site: 'Left arm' },
        record_date: '2026-01-15', tags: ['vaccination', 'COVID-19', 'booster'], is_sensitive: false },
      { vendorId: medplus, record_type: 'PRESCRIPTION', record_category: 'CLINICAL',
        title: 'Metformin + Glipizide (Diabetes Management)',
        description: 'Monthly refill prescription for Type 2 Diabetes management',
        data: { medications: ['Metformin 500mg 2x/day', 'Glipizide 5mg 1x/day'], monitoring: 'Blood glucose monthly', doctor: 'Dr. Priya Nair' },
        record_date: '2026-06-01', tags: ['diabetes', 'chronic', 'monthly-refill'], is_sensitive: true },
      { vendorId: self, record_type: 'IMAGING', record_category: 'DIAGNOSTIC',
        title: 'Chest X-Ray (Pre-operative)',
        description: 'Routine pre-op chest X-ray — clear, no abnormalities detected',
        data: { findings: 'Clear lung fields. No consolidation. Heart size normal.', modality: 'X-Ray', region: 'Chest PA view', result: 'NORMAL',
          attachments: [{ name: 'chest_xray_20260516.jpg', type: 'image/jpeg', size: '1.8 MB', note: 'DICOM converted to JPEG for viewing' }] },
        record_date: '2026-05-16', tags: ['xray', 'pre-op', 'imaging'], is_sensitive: false },
      { vendorId: self, record_type: 'INSURANCE', record_category: 'ADMINISTRATIVE',
        title: 'Health Insurance — Apollo Munich Policy',
        description: 'Annual health insurance policy — covers hospitalization up to ₹5 lakh',
        data: { insurer: 'Apollo Munich', policyNo: 'AMHI-2026-4567890', sumInsured: '₹5,00,000', premium: '₹8,400/year', validTo: '2027-03-31' },
        record_date: '2026-04-01', tags: ['insurance', 'annual', 'cashless'], is_sensitive: true },
      { vendorId: self, record_type: 'CONSULTATION', record_category: 'CLINICAL',
        title: 'Cardiology Follow-up Consultation',
        description: 'Follow-up for borderline LDL — advised lifestyle changes',
        data: { doctor: 'Dr. Ramesh Iyer', specialization: 'Cardiology', advice: 'Reduce saturated fats, 30 min walk daily', nextVisit: '2026-09-10' },
        record_date: '2026-04-20', tags: ['cardiology', 'follow-up', 'lifestyle'], is_sensitive: false },
    ];

    let inserted = 0;
    for (const r of samples) {
      // Skip if this user already has a record with the same title (idempotent seed)
      const existing = await query(
        'SELECT id FROM health_records WHERE user_id = $1 AND title = $2 LIMIT 1',
        [userId, r.title]
      );
      if (existing.rows.length > 0) continue;

      const dataString = JSON.stringify(r.data);
      const dataEncrypted = encrypt(dataString);
      const dataHash = hashData(dataString);
      const { v4: uuidv4 } = require('uuid');
      await query(
        `INSERT INTO health_records
          (id, user_id, vendor_id, record_type, record_category, title, description,
           data_encrypted, data_hash, record_date, tags, is_sensitive, created_by_vendor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [uuidv4(), userId, r.vendorId, r.record_type, r.record_category,
         r.title, r.description, dataEncrypted, dataHash,
         r.record_date, r.tags, r.is_sensitive, r.vendorId]
      );
      inserted++;
    }

    const total = await query('SELECT COUNT(*) FROM health_records WHERE user_id = $1', [userId]);

    await writeAuditLog({
      eventType: 'RECORDS_SEEDED', eventCategory: 'DATA',
      actorType: 'USER', actorId: userId, actorHealthId: req.user.healthId,
      eventDetails: { samplesInserted: inserted },
      outcome: 'SUCCESS',
    });

    return res.json({ message: `Sample records loaded.`, seeded: inserted, total: parseInt(total.rows[0].count) });
  } catch (err) {
    logger.error(`seedMyRecords error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to seed records' });
  }
}

module.exports = { createRecord, getMyRecords, getRecordById, vendorAccessRecords, uploadMyRecord, seedMyRecords };
