const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'defaultkey12345678901234567890123', 'utf8').slice(0, 32);
const IV = Buffer.from(process.env.ENCRYPTION_IV || 'defaultiv1234567', 'utf8').slice(0, 16);

/**
 * Encrypt plaintext data using AES-256-CBC.
 * Uses a random IV per encryption for semantic security.
 */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an AES-256-CBC encrypted string.
 */
function decrypt(encryptedData) {
  const [ivHex, encrypted] = encryptedData.split(':');
  if (!ivHex || !encrypted) throw new Error('Invalid encrypted data format');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Compute SHA-256 hash for integrity verification.
 */
function hashData(data) {
  return crypto.createHash('sha256').update(String(data)).digest('hex');
}

/**
 * Compute HMAC-SHA256 for token signatures.
 */
function signToken(data, secret) {
  return crypto.createHmac('sha256', secret || process.env.CONSENT_TOKEN_SECRET).update(data).digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
function safeCompare(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = { encrypt, decrypt, hashData, signToken, safeCompare };
