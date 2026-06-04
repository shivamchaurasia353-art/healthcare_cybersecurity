/**
 * SQLite database interface — drop-in replacement for pg-based db.js.
 * Handles: $n params → ?, = ANY($n) → IN(...), NOW()-INTERVAL → datetime(),
 *          Date objects, boolean coercion, JSON array columns, COUNT(*) alias.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const DB_PATH = process.env.SQLITE_PATH || path.resolve(__dirname, '../../../data/healthsecure.db');
const SCHEMA_PATH = path.resolve(__dirname, './schema.sqlite.sql');

let _db = null;

function getDb() {
  if (!_db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

/**
 * Convert a param value to a SQLite-safe scalar.
 */
function normalizeParam(val) {
  if (val === undefined || val === null) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (Array.isArray(val)) return JSON.stringify(val);
  return val;
}

/**
 * Auto-parse JSON strings and normalize COUNT(*) column name.
 */
function parseRow(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k === 'COUNT(*)' ? 'count' : k;
    if (typeof v === 'string' && v.length > 1 && (v[0] === '[' || v[0] === '{')) {
      try { out[key] = JSON.parse(v); } catch { out[key] = v; }
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Convert PostgreSQL-style SQL to SQLite-compatible SQL and build params array.
 * - NOW() - INTERVAL 'N unit'  →  datetime('now', '-N unit')
 * - NOW()                       →  datetime('now')
 * - = ANY($n)                   →  IN (?, ?, ...)  (array param expanded)
 * - $n                          →  ?
 */
function buildQuery(rawSql, params = []) {
  // Timestamp function conversions
  let sql = rawSql.replace(
    /NOW\s*\(\s*\)\s*-\s*INTERVAL\s*'(\d+)\s*(hour|hours|day|days|minute|minutes|second|seconds|month|months|year|years)'/gi,
    (_, n, unit) => `datetime('now', '-${n} ${unit}')`
  );
  sql = sql.replace(/\bNOW\s*\(\s*\)/gi, "datetime('now')");

  if (!params.length) return { sql, params: [] };

  // Collect token positions: ANY($n) patterns and standalone $n references
  const tokens = [];
  let m;

  const anyRe = /=\s*ANY\s*\(\s*\$(\d+)\s*\)/gi;
  while ((m = anyRe.exec(sql)) !== null) {
    tokens.push({ type: 'any', start: m.index, end: m.index + m[0].length, idx: parseInt(m[1]) - 1 });
  }

  const paramRe = /\$(\d+)/g;
  while ((m = paramRe.exec(sql)) !== null) {
    const insideAny = tokens.some(t => m.index >= t.start && m.index < t.end);
    if (!insideAny) {
      tokens.push({ type: 'param', start: m.index, end: m.index + m[0].length, idx: parseInt(m[1]) - 1 });
    }
  }

  tokens.sort((a, b) => a.start - b.start);

  let result = '';
  let lastEnd = 0;
  const finalParams = [];

  for (const token of tokens) {
    result += sql.slice(lastEnd, token.start);
    lastEnd = token.end;

    const val = params[token.idx];
    if (token.type === 'any') {
      const arr = Array.isArray(val) ? val : [val];
      result += `IN (${arr.map(() => '?').join(', ')})`;
      finalParams.push(...arr.map(normalizeParam));
    } else {
      result += '?';
      finalParams.push(normalizeParam(val));
    }
  }

  result += sql.slice(lastEnd);
  return { sql: result, params: finalParams };
}

async function query(text, params = []) {
  const db = getDb();
  const start = Date.now();
  const { sql, params: fp } = buildQuery(text, params);

  try {
    const stmt = db.prepare(sql);
    const isRead = /^\s*(SELECT|WITH|EXPLAIN|PRAGMA)\b/i.test(sql);
    const hasReturning = /\bRETURNING\b/i.test(sql);

    let rows;
    if (isRead || hasReturning) {
      rows = stmt.all(...fp).map(parseRow);
    } else {
      stmt.run(...fp);
      rows = [];
    }

    const duration = Date.now() - start;
    if (duration > 1000) logger.warn(`Slow query (${duration}ms): ${text.substring(0, 100)}`);

    return { rows, rowCount: rows.length };
  } catch (err) {
    logger.error(`SQLite error: ${err.message}\nSQL: ${sql}`);
    throw err;
  }
}

async function connectDB() {
  const db = getDb();
  if (fs.existsSync(SCHEMA_PATH)) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
  } else {
    logger.warn('schema.sqlite.sql not found — skipping schema init');
  }
  logger.info(`SQLite connected: ${DB_PATH}`);
}

// Compatibility shim for transaction use in legacy code
async function getClient() {
  return {
    query: (text, params) => query(text, params),
    release: () => {},
  };
}

module.exports = { query, connectDB, getClient };
