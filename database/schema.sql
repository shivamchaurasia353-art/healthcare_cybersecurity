-- ============================================================
-- HealthSecure Platform - Database Schema
-- PhD Research: Cybersecurity Techniques for Protecting Healthcare Data
-- Consent-driven data sharing (DigiLocker model) + ABHA-like Lifetime Health ID
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS TABLE (Patients)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    health_id VARCHAR(20) UNIQUE NOT NULL,          -- ABHA-style lifetime ID e.g. ABHA-XXXX-XXXX
    full_name VARCHAR(150) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR(10) NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    aadhar_hash VARCHAR(255),                        -- Hashed Aadhaar reference (never store raw)
    mfa_secret VARCHAR(255),                         -- TOTP secret (stored encrypted)
    mfa_enabled BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_health_id ON users(health_id);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- VENDORS TABLE (Hospitals, Labs, Pharmacies, Insurers, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    vendor_type VARCHAR(50) NOT NULL,                -- HOSPITAL, LABORATORY, PHARMACY, INSURER, TELEHEALTH
    license_number VARCHAR(100) UNIQUE NOT NULL,
    api_key_hash VARCHAR(255) UNIQUE NOT NULL,       -- Hashed API key for vendor authentication
    public_key TEXT,                                 -- Vendor's public key for encrypted data exchange
    contact_email VARCHAR(150) NOT NULL,
    address TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_approved BOOLEAN DEFAULT FALSE,               -- Admin approval required
    approved_at TIMESTAMPTZ,
    approved_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vendors_vendor_code ON vendors(vendor_code);
CREATE INDEX idx_vendors_vendor_type ON vendors(vendor_type);

-- ============================================================
-- HEALTH RECORDS TABLE (EHR)
-- ============================================================
CREATE TABLE IF NOT EXISTS health_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    record_type VARCHAR(50) NOT NULL,               -- PRESCRIPTION, LAB_REPORT, DISCHARGE_SUMMARY, IMAGING, VACCINATION, INSURANCE
    record_category VARCHAR(50) NOT NULL,           -- CLINICAL, DIAGNOSTIC, ADMINISTRATIVE, FINANCIAL
    title VARCHAR(200) NOT NULL,
    description TEXT,
    data_encrypted TEXT NOT NULL,                   -- AES-256 encrypted record payload
    data_hash VARCHAR(255) NOT NULL,                -- SHA-256 hash for integrity verification
    record_date DATE NOT NULL,
    tags TEXT[],
    is_sensitive BOOLEAN DEFAULT FALSE,             -- Requires extra consent
    is_active BOOLEAN DEFAULT TRUE,
    created_by_vendor UUID REFERENCES vendors(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_health_records_user_id ON health_records(user_id);
CREATE INDEX idx_health_records_vendor_id ON health_records(vendor_id);
CREATE INDEX idx_health_records_record_type ON health_records(record_type);
CREATE INDEX idx_health_records_record_date ON health_records(record_date);

-- ============================================================
-- CONSENT REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS consent_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_ref VARCHAR(50) UNIQUE NOT NULL,        -- Human-readable reference
    user_id UUID NOT NULL REFERENCES users(id),
    requesting_vendor_id UUID NOT NULL REFERENCES vendors(id),
    purpose VARCHAR(100) NOT NULL,                  -- TREATMENT, DIAGNOSIS, INSURANCE_CLAIM, RESEARCH, EMERGENCY
    requested_data_types TEXT[] NOT NULL,           -- Specific record types requested
    requested_from DATE,
    requested_to DATE,
    urgency VARCHAR(20) DEFAULT 'ROUTINE',          -- ROUTINE, URGENT, EMERGENCY
    requester_note TEXT,
    status VARCHAR(20) DEFAULT 'PENDING',           -- PENDING, APPROVED, DENIED, REVOKED, EXPIRED
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,                -- Request auto-expires
    responded_at TIMESTAMPTZ
);

CREATE INDEX idx_consent_requests_user_id ON consent_requests(user_id);
CREATE INDEX idx_consent_requests_vendor_id ON consent_requests(requesting_vendor_id);
CREATE INDEX idx_consent_requests_status ON consent_requests(status);

-- ============================================================
-- CONSENT TOKENS TABLE (Active approved consents)
-- ============================================================
CREATE TABLE IF NOT EXISTS consent_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_ref VARCHAR(100) UNIQUE NOT NULL,         -- Unique consent token reference
    consent_request_id UUID NOT NULL REFERENCES consent_requests(id),
    user_id UUID NOT NULL REFERENCES users(id),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    purpose VARCHAR(100) NOT NULL,
    allowed_record_types TEXT[] NOT NULL,
    allowed_record_ids UUID[],                      -- Specific records if scoped
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    access_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMPTZ,
    digital_signature TEXT NOT NULL,                -- HMAC signature for token integrity
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_tokens_token_ref ON consent_tokens(token_ref);
CREATE INDEX idx_consent_tokens_user_id ON consent_tokens(user_id);
CREATE INDEX idx_consent_tokens_vendor_id ON consent_tokens(vendor_id);
CREATE INDEX idx_consent_tokens_valid_until ON consent_tokens(valid_until);
CREATE INDEX idx_consent_tokens_is_revoked ON consent_tokens(is_revoked);

-- ============================================================
-- AUDIT LOGS TABLE (Immutable - Insert Only)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id VARCHAR(100) UNIQUE NOT NULL,          -- Deterministic event ID for deduplication
    event_type VARCHAR(50) NOT NULL,                -- LOGIN, LOGOUT, CONSENT_REQUEST, CONSENT_GRANT, DATA_ACCESS, etc.
    event_category VARCHAR(30) NOT NULL,            -- AUTH, CONSENT, DATA, VENDOR, ADMIN, SECURITY
    severity VARCHAR(20) DEFAULT 'INFO',            -- INFO, WARNING, CRITICAL
    actor_type VARCHAR(20) NOT NULL,                -- USER, VENDOR, ADMIN, SYSTEM
    actor_id UUID,
    actor_health_id VARCHAR(20),
    target_resource_type VARCHAR(50),
    target_resource_id UUID,
    vendor_id UUID,
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    event_details JSONB,
    outcome VARCHAR(20) NOT NULL,                   -- SUCCESS, FAILURE, BLOCKED
    risk_score SMALLINT DEFAULT 0,                  -- 0-100 risk score for anomaly detection
    integrity_hash VARCHAR(255) NOT NULL,           -- Chain hash for tamper detection
    prev_event_hash VARCHAR(255),                   -- Links to previous audit entry
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs are append-only (no UPDATE or DELETE)
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_vendor_id ON audit_logs(vendor_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX idx_audit_logs_outcome ON audit_logs(outcome);

-- Prevent audit log tampering
CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- ============================================================
-- SECURITY ALERTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS security_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_type VARCHAR(50) NOT NULL,                -- BRUTE_FORCE, UNUSUAL_ACCESS, EXPIRED_CONSENT_USE, etc.
    severity VARCHAR(20) NOT NULL,                  -- LOW, MEDIUM, HIGH, CRITICAL
    actor_id UUID,
    vendor_id UUID,
    description TEXT NOT NULL,
    related_audit_ids UUID[],
    is_acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by UUID,
    acknowledged_at TIMESTAMPTZ,
    resolution_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_security_alerts_severity ON security_alerts(severity);
CREATE INDEX idx_security_alerts_is_acknowledged ON security_alerts(is_acknowledged);
CREATE INDEX idx_security_alerts_created_at ON security_alerts(created_at DESC);

-- ============================================================
-- USER SESSIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_used TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_refresh_token ON user_sessions(refresh_token_hash);

-- ============================================================
-- OTP TABLE (for MFA and verification)
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    phone VARCHAR(15),
    otp_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(30) NOT NULL,                   -- REGISTRATION, LOGIN, CONSENT_CONFIRM, PASSWORD_RESET
    is_used BOOLEAN DEFAULT FALSE,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_otp_user_id ON otp_records(user_id);
CREATE INDEX idx_otp_expires_at ON otp_records(expires_at);

-- ============================================================
-- ADMIN USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'MODERATOR',  -- SUPER_ADMIN, ADMIN, MODERATOR
    mfa_secret VARCHAR(255),
    mfa_enabled BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Update trigger for updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_health_records_updated_at BEFORE UPDATE ON health_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
