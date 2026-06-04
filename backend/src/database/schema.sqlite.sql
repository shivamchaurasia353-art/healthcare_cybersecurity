-- ============================================================
-- HealthSecure Platform - SQLite Schema
-- PhD Research: Cybersecurity Techniques for Protecting Healthcare Data
-- Converted from PostgreSQL to SQLite
-- ============================================================

-- ============================================================
-- USERS TABLE (Patients)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    health_id TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    gender TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    aadhar_hash TEXT,
    mfa_secret TEXT,
    mfa_enabled INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_health_id ON users(health_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- VENDORS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    vendor_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    vendor_type TEXT NOT NULL,
    license_number TEXT UNIQUE NOT NULL,
    api_key_hash TEXT UNIQUE NOT NULL,
    public_key TEXT,
    contact_email TEXT NOT NULL,
    address TEXT,
    is_active INTEGER DEFAULT 1,
    is_approved INTEGER DEFAULT 0,
    approved_at TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendors_vendor_code ON vendors(vendor_code);
CREATE INDEX IF NOT EXISTS idx_vendors_vendor_type ON vendors(vendor_type);

-- ============================================================
-- HEALTH RECORDS TABLE (EHR)
-- ============================================================
CREATE TABLE IF NOT EXISTS health_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor_id TEXT NOT NULL REFERENCES vendors(id),
    record_type TEXT NOT NULL,
    record_category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    data_encrypted TEXT NOT NULL,
    data_hash TEXT NOT NULL,
    record_date TEXT NOT NULL,
    tags TEXT,                                  -- JSON array stored as TEXT
    is_sensitive INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_by_vendor TEXT REFERENCES vendors(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_records_user_id ON health_records(user_id);
CREATE INDEX IF NOT EXISTS idx_health_records_vendor_id ON health_records(vendor_id);
CREATE INDEX IF NOT EXISTS idx_health_records_record_type ON health_records(record_type);
CREATE INDEX IF NOT EXISTS idx_health_records_record_date ON health_records(record_date);

-- ============================================================
-- CONSENT REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS consent_requests (
    id TEXT PRIMARY KEY,
    request_ref TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    requesting_vendor_id TEXT NOT NULL REFERENCES vendors(id),
    purpose TEXT NOT NULL,
    requested_data_types TEXT NOT NULL,         -- JSON array stored as TEXT
    requested_from TEXT,
    requested_to TEXT,
    urgency TEXT DEFAULT 'ROUTINE',
    requester_note TEXT,
    status TEXT DEFAULT 'PENDING',
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_requests_user_id ON consent_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_requests_vendor_id ON consent_requests(requesting_vendor_id);
CREATE INDEX IF NOT EXISTS idx_consent_requests_status ON consent_requests(status);

-- ============================================================
-- CONSENT TOKENS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS consent_tokens (
    id TEXT PRIMARY KEY,
    token_ref TEXT UNIQUE NOT NULL,
    consent_request_id TEXT NOT NULL REFERENCES consent_requests(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    vendor_id TEXT NOT NULL REFERENCES vendors(id),
    purpose TEXT NOT NULL,
    allowed_record_types TEXT NOT NULL,         -- JSON array stored as TEXT
    allowed_record_ids TEXT,                    -- JSON array stored as TEXT
    valid_from TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    is_revoked INTEGER DEFAULT 0,
    revoked_at TEXT,
    revocation_reason TEXT,
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,
    digital_signature TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consent_tokens_token_ref ON consent_tokens(token_ref);
CREATE INDEX IF NOT EXISTS idx_consent_tokens_user_id ON consent_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_tokens_vendor_id ON consent_tokens(vendor_id);
CREATE INDEX IF NOT EXISTS idx_consent_tokens_valid_until ON consent_tokens(valid_until);
CREATE INDEX IF NOT EXISTS idx_consent_tokens_is_revoked ON consent_tokens(is_revoked);

-- ============================================================
-- AUDIT LOGS TABLE (Append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL,
    severity TEXT DEFAULT 'INFO',
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    actor_health_id TEXT,
    target_resource_type TEXT,
    target_resource_id TEXT,
    vendor_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    session_id TEXT,
    event_details TEXT,                         -- JSON stored as TEXT
    outcome TEXT NOT NULL,
    risk_score INTEGER DEFAULT 0,
    integrity_hash TEXT NOT NULL,
    prev_event_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_vendor_id ON audit_logs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_outcome ON audit_logs(outcome);

-- Prevent audit log tampering via triggers
CREATE TRIGGER IF NOT EXISTS no_update_audit
BEFORE UPDATE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'Audit logs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS no_delete_audit
BEFORE DELETE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'Audit logs are immutable');
END;

-- ============================================================
-- SECURITY ALERTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS security_alerts (
    id TEXT PRIMARY KEY,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    actor_id TEXT,
    vendor_id TEXT,
    description TEXT NOT NULL,
    related_audit_ids TEXT,                     -- JSON array stored as TEXT
    is_acknowledged INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    resolution_note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_security_alerts_is_acknowledged ON security_alerts(is_acknowledged);
CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at ON security_alerts(created_at DESC);

-- ============================================================
-- USER SESSIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    last_used TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token ON user_sessions(refresh_token_hash);
