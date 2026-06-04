/**
 * HealthSecure — Seed Script
 * Creates test vendors, a demo patient, and sample health records.
 * Run from project root: node backend/scripts/seed.js
 *
 * Requires: .env (root) or backend/.env to have DB_* vars set.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { query, connectDB } = require('../src/database/db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function hashData(data) {
  return crypto.createHash('sha256').update(String(data)).digest('hex');
}

function generateApiKey() {
  return 'hsk_' + crypto.randomBytes(24).toString('hex');
}

function encrypt(plaintext) {
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'defaultkey12345678901234567890123';
  const KEY = Buffer.from(ENCRYPTION_KEY, 'utf8').slice(0, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function generateHealthId() {
  const r = () => Math.floor(1000 + Math.random() * 9000);
  return `ABHA-${r()}-${r()}-${r()}`;
}

async function seed() {
  await connectDB();
  console.log('\n🌱 HealthSecure Seed Script\n' + '='.repeat(50));

  try {
    await query('BEGIN');

    // ─────────────────────────────────────────────
    // 1. Create Vendors
    // ─────────────────────────────────────────────
    console.log('\n📋 Creating vendors...\n');

    const vendorDefs = [
      {
        vendor_code: 'APOLLO_HYD',
        name: 'Apollo Hospitals Hyderabad',
        vendor_type: 'HOSPITAL',
        license_number: 'HOSP-AP-2024-001',
        contact_email: 'it@apollohyd.com',
        address: 'Jubilee Hills, Hyderabad, Telangana',
      },
      {
        vendor_code: 'CITYLAB_HYD',
        name: 'CityLab Diagnostics',
        vendor_type: 'LABORATORY',
        license_number: 'LAB-TS-2024-042',
        contact_email: 'reports@citylab.com',
        address: 'Banjara Hills, Hyderabad, Telangana',
      },
      {
        vendor_code: 'MEDPLUS_PH',
        name: 'MedPlus Pharmacy',
        vendor_type: 'PHARMACY',
        license_number: 'PHARM-TS-2024-009',
        contact_email: 'orders@medplus.com',
        address: 'Secunderabad, Hyderabad, Telangana',
      },
      {
        vendor_code: 'SELF_UPLOAD',
        name: 'Patient Self-Upload',
        vendor_type: 'TELEHEALTH',
        license_number: 'SYSTEM-SELF-0001',
        contact_email: 'system@healthsecure.internal',
        address: 'HealthSecure Platform',
      },
    ];

    const vendorResults = [];
    for (const v of vendorDefs) {
      const apiKey = generateApiKey();
      const apiKeyHash = hashData(apiKey);

      // Upsert: skip if already exists
      const existing = await query('SELECT id, vendor_code FROM vendors WHERE vendor_code = $1', [v.vendor_code]);
      if (existing.rows.length) {
        console.log(`  ⚠ Vendor ${v.vendor_code} already exists — skipping`);
        vendorResults.push({ ...existing.rows[0], apiKey: '(already exists — run cleanup first)' });
        continue;
      }

      const res = await query(
        `INSERT INTO vendors (id, vendor_code, name, vendor_type, license_number, api_key_hash, contact_email, address, is_active, is_approved, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,1,datetime('now')) RETURNING id, vendor_code, name`,
        [require('uuid').v4(), v.vendor_code, v.name, v.vendor_type, v.license_number, apiKeyHash, v.contact_email, v.address]
      );

      const row = res.rows[0];
      vendorResults.push({ ...row, apiKey });

      if (v.vendor_code === 'SELF_UPLOAD') {
        console.log(`  ✓ ${v.name} [SYSTEM] — ID: ${row.id}`);
      } else {
        console.log(`  ✓ ${v.name}`);
        console.log(`    Vendor Code : ${row.vendor_code}`);
        console.log(`    API Key     : ${apiKey}`);
        console.log(`    Vendor ID   : ${row.id}`);
        console.log('');
      }
    }

    // Get SELF vendor ID
    const selfVendor = await query("SELECT id FROM vendors WHERE vendor_code = 'SELF_UPLOAD' LIMIT 1");
    const selfVendorId = selfVendor.rows[0].id;

    // ─────────────────────────────────────────────
    // 2. Create Test Patient
    // ─────────────────────────────────────────────
    console.log('\n👤 Creating test patient...\n');

    const demoHealthId = generateHealthId();
    const demoPassword = 'Demo@1234';
    const passwordHash = await bcrypt.hash(demoPassword, 12);

    // Check if demo patient already exists
    const existingPatient = await query(
      "SELECT id, health_id FROM users WHERE email = 'demo@healthsecure.test'"
    );

    let patientId, patientHealthId;
    if (existingPatient.rows.length) {
      patientId = existingPatient.rows[0].id;
      patientHealthId = existingPatient.rows[0].health_id;
      console.log(`  ⚠ Demo patient already exists`);
      console.log(`    Health ID   : ${patientHealthId}`);
      console.log(`    Password    : ${demoPassword}`);
    } else {
      const patientRes = await query(
        `INSERT INTO users (id, health_id, full_name, date_of_birth, gender, phone, email, password_hash, is_verified, is_active)
         VALUES ($1,$2,'Rahul Sharma Demo','1990-06-15','MALE','9876543210','demo@healthsecure.test',$3,1,1)
         RETURNING id, health_id`,
        [require('uuid').v4(), demoHealthId, passwordHash]
      );
      patientId = patientRes.rows[0].id;
      patientHealthId = patientRes.rows[0].health_id;

      console.log(`  ✓ Patient created`);
      console.log(`    Full Name   : Rahul Sharma Demo`);
      console.log(`    Health ID   : ${patientHealthId}  ← Use this in the Vendor Demo App`);
      console.log(`    Email       : demo@healthsecure.test`);
      console.log(`    Password    : ${demoPassword}`);
    }

    // ─────────────────────────────────────────────
    // 3. Create Second Test Patient
    // ─────────────────────────────────────────────
    const existingPatient2 = await query(
      "SELECT id, health_id FROM users WHERE email = 'priya@healthsecure.test'"
    );

    if (!existingPatient2.rows.length) {
      const p2HealthId = generateHealthId();
      const p2Hash = await bcrypt.hash('Priya@1234', 12);
      await query(
        `INSERT INTO users (id, health_id, full_name, date_of_birth, gender, phone, email, password_hash, is_verified, is_active)
         VALUES ($1,$2,'Priya Patel Demo','1985-03-22','FEMALE','9123456789','priya@healthsecure.test',$3,1,1)`,
        [require('uuid').v4(), p2HealthId, p2Hash]
      );
      console.log(`\n  ✓ Second patient: Priya Patel Demo`);
      console.log(`    Health ID   : ${p2HealthId}`);
      console.log(`    Password    : Priya@1234`);
    }

    // ─────────────────────────────────────────────
    // 4. Create Health Records for Demo Patient
    // ─────────────────────────────────────────────
    console.log('\n🗂  Creating health records for demo patient...\n');

    // Get Apollo and CityLab vendor IDs
    const apolloRes = await query("SELECT id FROM vendors WHERE vendor_code = 'APOLLO_HYD' LIMIT 1");
    const cityLabRes = await query("SELECT id FROM vendors WHERE vendor_code = 'CITYLAB_HYD' LIMIT 1");
    const medplusRes = await query("SELECT id FROM vendors WHERE vendor_code = 'MEDPLUS_PH' LIMIT 1");

    const apolloId = apolloRes.rows[0]?.id || selfVendorId;
    const cityLabId = cityLabRes.rows[0]?.id || selfVendorId;
    const medplusId = medplusRes.rows[0]?.id || selfVendorId;

    // Check if records already exist
    const existingRecords = await query(
      'SELECT COUNT(*) FROM health_records WHERE user_id = $1', [patientId]
    );
    if (parseInt(existingRecords.rows[0].count) > 0) {
      console.log(`  ⚠ Records already exist for demo patient — skipping`);
    } else {
      const records = [
        {
          vendorId: apolloId,
          record_type: 'PRESCRIPTION',
          record_category: 'CLINICAL',
          title: 'Amoxicillin + Ibuprofen Prescription',
          description: 'Post-operative antibiotic and pain relief course for 7 days',
          data: { medications: ['Amoxicillin 500mg 3x/day', 'Ibuprofen 400mg 2x/day'], instructions: 'Take after food', doctor: 'Dr. Anand Reddy', specialization: 'General Surgery' },
          record_date: '2026-05-20',
          tags: ['antibiotics', 'post-op'],
          is_sensitive: false,
        },
        {
          vendorId: cityLabId,
          record_type: 'LAB_REPORT',
          record_category: 'DIAGNOSTIC',
          title: 'Complete Blood Count (CBC) Report',
          description: 'Routine blood work — all parameters within normal range',
          data: { hemoglobin: '14.2 g/dL', WBC: '7200 /μL', platelets: '2.4 lakh /μL', RBC: '4.8 million/μL', result: 'NORMAL', lab: 'CityLab Diagnostics, Hyderabad' },
          record_date: '2026-05-15',
          tags: ['blood-test', 'CBC'],
          is_sensitive: false,
        },
        {
          vendorId: cityLabId,
          record_type: 'LAB_REPORT',
          record_category: 'DIAGNOSTIC',
          title: 'Lipid Profile Report',
          description: 'Annual cardiac risk assessment — LDL borderline high',
          data: { totalCholesterol: '198 mg/dL', LDL: '138 mg/dL', HDL: '48 mg/dL', triglycerides: '165 mg/dL', risk: 'MODERATE', recommendation: 'Diet modification advised' },
          record_date: '2026-04-10',
          tags: ['cholesterol', 'cardiac'],
          is_sensitive: false,
        },
        {
          vendorId: apolloId,
          record_type: 'DISCHARGE_SUMMARY',
          record_category: 'CLINICAL',
          title: 'Appendectomy Discharge Summary',
          description: 'Laparoscopic appendectomy — successful. Discharged after 3 days.',
          data: { procedure: 'Laparoscopic Appendectomy', surgeon: 'Dr. Sunita Rao', ward: 'Surgical Ward B', admitDate: '2026-05-17', dischargeDate: '2026-05-20', diagnosis: 'Acute Appendicitis', followUp: '7 days' },
          record_date: '2026-05-20',
          tags: ['surgery', 'appendectomy', 'inpatient'],
          is_sensitive: false,
        },
        {
          vendorId: apolloId,
          record_type: 'VACCINATION',
          record_category: 'CLINICAL',
          title: 'COVID-19 Booster (Covaxin)',
          description: 'Third dose booster — administered at Apollo Vaccination Centre',
          data: { vaccine: 'Covaxin (BBV152)', dose: 'Booster (3rd)', batchNo: 'CVX2026-B47', site: 'Left arm', administered_by: 'Nurse Kavitha M.', nextDue: '2027-01-15' },
          record_date: '2026-01-15',
          tags: ['vaccination', 'COVID-19', 'booster'],
          is_sensitive: false,
        },
        {
          vendorId: medplusId,
          record_type: 'PRESCRIPTION',
          record_category: 'CLINICAL',
          title: 'Metformin + Glipizide (Diabetes Management)',
          description: 'Monthly refill prescription for Type 2 Diabetes management',
          data: { medications: ['Metformin 500mg 2x/day', 'Glipizide 5mg 1x/day (before breakfast)'], monitoring: 'Blood glucose monthly', doctor: 'Dr. Priya Nair', specialization: 'Endocrinology', nextReview: '2026-07-10' },
          record_date: '2026-06-01',
          tags: ['diabetes', 'chronic', 'monthly-refill'],
          is_sensitive: true,
        },
        {
          vendorId: selfVendorId,
          record_type: 'IMAGING',
          record_category: 'DIAGNOSTIC',
          title: 'Chest X-Ray (Pre-operative)',
          description: 'Routine pre-op chest X-ray — clear, no abnormalities detected',
          data: { findings: 'Clear lung fields. No consolidation. Heart size normal. No pleural effusion.', radiologist: 'Dr. Kiran Babu', modality: 'X-Ray', region: 'Chest PA view', result: 'NORMAL' },
          record_date: '2026-05-16',
          tags: ['xray', 'pre-op', 'imaging'],
          is_sensitive: false,
        },
        {
          vendorId: selfVendorId,
          record_type: 'INSURANCE',
          record_category: 'ADMINISTRATIVE',
          title: 'Health Insurance — Apollo Munich Policy',
          description: 'Annual health insurance policy document — covers hospitalization up to ₹5 lakh',
          data: { insurer: 'Apollo Munich Health Insurance', policyNo: 'AMHI-2026-4567890', sumInsured: '₹5,00,000', premium: '₹8,400/year', validFrom: '2026-04-01', validTo: '2027-03-31', network: 'Cashless at 5000+ hospitals' },
          record_date: '2026-04-01',
          tags: ['insurance', 'annual', 'cashless'],
          is_sensitive: true,
        },
      ];

      for (const r of records) {
        const dataString = JSON.stringify(r.data);
        const dataEncrypted = encrypt(dataString);
        const dataHash = crypto.createHash('sha256').update(dataString).digest('hex');

        await query(
          `INSERT INTO health_records (id, user_id, vendor_id, record_type, record_category, title, description, data_encrypted, data_hash, record_date, tags, is_sensitive, created_by_vendor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [require('uuid').v4(), patientId, r.vendorId, r.record_type, r.record_category, r.title, r.description,
           dataEncrypted, dataHash, r.record_date, JSON.stringify(r.tags), r.is_sensitive ? 1 : 0, r.vendorId]
        );
        console.log(`  ✓ [${r.record_type}] ${r.title}`);
      }
    }

    await query('COMMIT');

    // ─────────────────────────────────────────────
    // Save keys to .vendor-keys file
    // ─────────────────────────────────────────────
    const fs = require('fs');
    // Write to /app/data when running inside container (writable volume), otherwise project root
    const keysDir = process.env.SQLITE_PATH
      ? require('path').dirname(process.env.SQLITE_PATH)
      : require('path').resolve(__dirname, '../../');
    const keysFilePath = require('path').join(keysDir, '.vendor-keys');
    const apolloVendor = vendorResults.find(v => v.vendor_code === 'APOLLO_HYD');
    const cityLabVendor = vendorResults.find(v => v.vendor_code === 'CITYLAB_HYD');
    const medplusVendor = vendorResults.find(v => v.vendor_code === 'MEDPLUS_PH');

    const keysContent = [
      '# HealthSecure — Vendor API Keys (generated by seed)',
      `# Generated: ${new Date().toISOString()}`,
      '',
      `DEMO_PATIENT_HEALTH_ID=${patientHealthId}`,
      `DEMO_PATIENT_EMAIL=demo@healthsecure.test`,
      `DEMO_PATIENT_PASSWORD=Demo@1234`,
      '',
      `APOLLO_API_KEY=${apolloVendor?.apiKey || '(pre-existing)'}`,
      `CITYLAB_API_KEY=${cityLabVendor?.apiKey || '(pre-existing)'}`,
      `MEDPLUS_API_KEY=${medplusVendor?.apiKey || '(pre-existing)'}`,
    ].join('\n') + '\n';

    fs.writeFileSync(keysFilePath, keysContent);
    console.log(`\n💾 Keys saved to .vendor-keys`);

    // ─────────────────────────────────────────────
    // Print Summary
    // ─────────────────────────────────────────────
    console.log('\n' + '='.repeat(50));
    console.log('✅  SEED COMPLETE — Summary');
    console.log('='.repeat(50));
    console.log('\n📱 Open the Patient App:');
    console.log('   http://localhost:3000');
    console.log(`   Email    : demo@healthsecure.test`);
    console.log(`   Password : Demo@1234`);
    console.log(`   Health ID: ${patientHealthId}`);
    console.log('\n🏥 Open the Vendor Demo App:');
    console.log('   http://localhost:5001');
    console.log('   → Paste Apollo or CityLab API key from above');
    console.log(`   → Use Health ID: ${patientHealthId}`);
    console.log('\n' + '='.repeat(50) + '\n');

  } catch (err) {
    try { await query('ROLLBACK'); } catch (_) { /* no-op if no active transaction */ }
    console.error('\n❌ Seed failed:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    process.exit(1);
  }
}

seed();
