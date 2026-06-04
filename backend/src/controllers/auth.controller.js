const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const { hashData, encrypt, decrypt } = require('../utils/crypto');
const { writeAuditLog } = require('../utils/audit');
const { logger } = require('../utils/logger');

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;

/**
 * Generate a unique ABHA-style lifetime health ID.
 * Format: ABHA-XXXX-XXXX-XXXX (where X is alphanumeric)
 */
async function generateHealthId() {
  const prefix = process.env.HEALTH_ID_PREFIX || 'ABHA';
  let healthId;
  let exists = true;
  while (exists) {
    const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
    healthId = `${prefix}-${seg()}-${seg()}-${seg()}`;
    const result = await query('SELECT id FROM users WHERE health_id = $1', [healthId]);
    exists = result.rows.length > 0;
  }
  return healthId;
}

/**
 * Register a new patient and issue lifetime Health ID.
 */
async function register(req, res) {
  const { fullName, dateOfBirth, gender, phone, email, password, aadharLast4 } = req.body;

  try {
    // Check duplicate
    const dup = await query('SELECT id FROM users WHERE phone = $1 OR email = $2', [phone, email]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Account with this phone or email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const healthId = await generateHealthId();
    // Hash Aadhaar reference - never store raw
    const aadharHash = aadharLast4 ? hashData(`AADHAR-${aadharLast4}-${phone}`) : null;

    const result = await query(
      `INSERT INTO users (id, health_id, full_name, date_of_birth, gender, phone, email, password_hash, aadhar_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, health_id, full_name, email`,
      [uuidv4(), healthId, fullName, dateOfBirth, gender, phone, email, passwordHash, aadharHash]
    );

    const user = result.rows[0];

    await writeAuditLog({
      eventType: 'USER_REGISTRATION',
      eventCategory: 'AUTH',
      actorType: 'USER',
      actorId: user.id,
      actorHealthId: user.health_id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      outcome: 'SUCCESS',
    });

    logger.info(`New user registered: ${user.health_id}`);
    return res.status(201).json({
      message: 'Registration successful. Please verify your account.',
      healthId: user.health_id,
      userId: user.id,
    });
  } catch (err) {
    logger.error(`Registration error: ${err.message}`);
    return res.status(500).json({ error: 'Registration failed' });
  }
}

/**
 * Login: Validates credentials, checks account lock, returns short-lived JWT.
 */
async function login(req, res) {
  const { email, password } = req.body;
  const ip = req.ip;

  try {
    const result = await query(
      'SELECT id, health_id, full_name, password_hash, mfa_enabled, mfa_secret, is_active, failed_login_attempts, locked_until FROM users WHERE email = $1',
      [email]
    );

    if (!result.rows.length) {
      // Generic error to prevent user enumeration
      await writeAuditLog({
        eventType: 'LOGIN_FAILURE', eventCategory: 'AUTH', severity: 'WARNING',
        actorType: 'USER', ipAddress: ip, userAgent: req.headers['user-agent'],
        eventDetails: { reason: 'user_not_found' }, outcome: 'FAILURE', riskScore: 30,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact support.' });
    }

    // Check account lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await writeAuditLog({
        eventType: 'LOGIN_BLOCKED', eventCategory: 'SECURITY', severity: 'WARNING',
        actorType: 'USER', actorId: user.id, actorHealthId: user.health_id,
        ipAddress: ip, outcome: 'BLOCKED', riskScore: 60,
      });
      return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      const lockUntil = newAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
        : null;

      await query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [newAttempts, lockUntil, user.id]
      );

      await writeAuditLog({
        eventType: 'LOGIN_FAILURE', eventCategory: 'AUTH', severity: 'WARNING',
        actorType: 'USER', actorId: user.id, actorHealthId: user.health_id,
        ipAddress: ip, userAgent: req.headers['user-agent'],
        eventDetails: { attempt: newAttempts }, outcome: 'FAILURE', riskScore: 40,
      });

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset failed attempts on success
    await query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1', [user.id]);

    if (user.mfa_enabled) {
      // Return a pre-auth token that only allows MFA verification
      const preAuthToken = jwt.sign(
        { userId: user.id, healthId: user.health_id, step: 'MFA_PENDING' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ requiresMfa: true, preAuthToken });
    }

    const { accessToken, refreshToken } = await issueTokens(user, req);
    await writeAuditLog({
      eventType: 'LOGIN_SUCCESS', eventCategory: 'AUTH',
      actorType: 'USER', actorId: user.id, actorHealthId: user.health_id,
      ipAddress: ip, userAgent: req.headers['user-agent'], outcome: 'SUCCESS',
    });

    return res.json({ accessToken, refreshToken, healthId: user.health_id, fullName: user.full_name });
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    return res.status(500).json({ error: 'Login failed' });
  }
}

/**
 * Verify TOTP MFA code after initial password login.
 */
async function verifyMfa(req, res) {
  const { preAuthToken, totpCode } = req.body;

  try {
    let decoded;
    try {
      decoded = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired pre-auth token' });
    }

    if (decoded.step !== 'MFA_PENDING') {
      return res.status(400).json({ error: 'Invalid token step' });
    }

    const result = await query('SELECT id, health_id, full_name, mfa_secret FROM users WHERE id = $1', [decoded.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    const user = result.rows[0];
    const secret = decrypt(user.mfa_secret);
    const isValid = authenticator.verify({ token: totpCode, secret });

    if (!isValid) {
      await writeAuditLog({
        eventType: 'MFA_FAILURE', eventCategory: 'AUTH', severity: 'WARNING',
        actorType: 'USER', actorId: user.id, actorHealthId: user.health_id,
        ipAddress: req.ip, outcome: 'FAILURE', riskScore: 55,
      });
      return res.status(401).json({ error: 'Invalid MFA code' });
    }

    const { accessToken, refreshToken } = await issueTokens(user, req, true);
    await writeAuditLog({
      eventType: 'MFA_SUCCESS', eventCategory: 'AUTH',
      actorType: 'USER', actorId: user.id, actorHealthId: user.health_id,
      ipAddress: req.ip, outcome: 'SUCCESS',
    });

    return res.json({ accessToken, refreshToken, healthId: user.health_id, fullName: user.full_name });
  } catch (err) {
    logger.error(`MFA verification error: ${err.message}`);
    return res.status(500).json({ error: 'MFA verification failed' });
  }
}

/**
 * Setup TOTP MFA - returns QR code and backup secret.
 */
async function setupMfa(req, res) {
  const userId = req.user.userId;

  try {
    const secret = authenticator.generateSecret();
    const user = await query('SELECT health_id, email FROM users WHERE id = $1', [userId]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    const otpUri = authenticator.keyuri(user.rows[0].email, process.env.MFA_APP_NAME || 'HealthSecure', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpUri);

    // Store encrypted secret temporarily (activated on verify)
    const encryptedSecret = encrypt(secret);
    await query('UPDATE users SET mfa_secret = $1 WHERE id = $2', [encryptedSecret, userId]);

    return res.json({ qrCode: qrCodeDataUrl, secret, message: 'Scan QR code with authenticator app' });
  } catch (err) {
    logger.error(`MFA setup error: ${err.message}`);
    return res.status(500).json({ error: 'MFA setup failed' });
  }
}

/**
 * Confirm and activate MFA.
 */
async function confirmMfa(req, res) {
  const { totpCode } = req.body;
  const userId = req.user.userId;

  try {
    const result = await query('SELECT mfa_secret, health_id FROM users WHERE id = $1', [userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    const secret = decrypt(result.rows[0].mfa_secret);
    const isValid = authenticator.verify({ token: totpCode, secret });

    if (!isValid) return res.status(400).json({ error: 'Invalid TOTP code. Please try again.' });

    await query('UPDATE users SET mfa_enabled = TRUE WHERE id = $1', [userId]);

    await writeAuditLog({
      eventType: 'MFA_ENABLED', eventCategory: 'AUTH',
      actorType: 'USER', actorId: userId, actorHealthId: result.rows[0].health_id,
      ipAddress: req.ip, outcome: 'SUCCESS',
    });

    return res.json({ message: 'MFA enabled successfully' });
  } catch (err) {
    logger.error(`MFA confirm error: ${err.message}`);
    return res.status(500).json({ error: 'MFA confirmation failed' });
  }
}

/**
 * Refresh access token using refresh token.
 */
async function refreshToken(req, res) {
  const { refreshToken: rt } = req.body;
  if (!rt) return res.status(401).json({ error: 'Refresh token required' });

  try {
    const decoded = jwt.verify(rt, process.env.JWT_REFRESH_SECRET);
    const rtHash = hashData(rt);

    const sessionResult = await query(
      'SELECT id, user_id FROM user_sessions WHERE refresh_token_hash = $1 AND is_active = TRUE AND expires_at > NOW()',
      [rtHash]
    );

    if (!sessionResult.rows.length) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const userResult = await query('SELECT id, health_id, full_name FROM users WHERE id = $1', [decoded.userId]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });

    const user = userResult.rows[0];
    const accessToken = jwt.sign(
      { userId: user.id, healthId: user.health_id, mfaVerified: decoded.mfaVerified },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    // Update last used
    await query('UPDATE user_sessions SET last_used = NOW() WHERE id = $1', [sessionResult.rows[0].id]);

    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

/**
 * Logout - invalidate session.
 */
async function logout(req, res) {
  const { refreshToken: rt } = req.body;
  if (rt) {
    const rtHash = hashData(rt);
    await query('UPDATE user_sessions SET is_active = FALSE WHERE refresh_token_hash = $1', [rtHash]);
  }

  await writeAuditLog({
    eventType: 'LOGOUT', eventCategory: 'AUTH',
    actorType: 'USER', actorId: req.user?.userId,
    ipAddress: req.ip, outcome: 'SUCCESS',
  });

  return res.json({ message: 'Logged out successfully' });
}

// ---- Helpers ----

async function issueTokens(user, req, mfaVerified = false) {
  const accessToken = jwt.sign(
    { userId: user.id, healthId: user.health_id, mfaVerified },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshTokenValue = jwt.sign(
    { userId: user.id, healthId: user.health_id, mfaVerified },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  const rtHash = hashData(refreshTokenValue);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await query(
    'INSERT INTO user_sessions (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), user.id, rtHash, req.ip, req.headers['user-agent'], expiresAt]
  );

  return { accessToken, refreshToken: refreshTokenValue };
}

module.exports = { register, login, verifyMfa, setupMfa, confirmMfa, refreshToken, logout };
