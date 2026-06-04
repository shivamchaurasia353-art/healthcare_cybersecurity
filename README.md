# HealthSecure — Cybersecurity Techniques for Protecting Healthcare Data

> **PhD Research Project** | Dept. of Computer Science & Engineering  
> Consent-driven healthcare data exchange inspired by **DigiLocker** and **ABHA (Ayushman Bharat Health Account)**

---

## Overview

HealthSecure is a full-stack, patient-centric healthcare data security platform that implements the core concepts of the PhD thesis _"Cybersecurity Techniques for Protecting Healthcare Data"_. It enables:

- **Lifetime Health ID** — An ABHA-style persistent identifier (e.g., `ABHA-XXXX-XXXX-XXXX`) valid across all healthcare vendors.
- **Consent-driven data sharing** — Inspired by DigiLocker; patients explicitly approve/deny/revoke each vendor's access to specific record types, for a defined purpose and duration.
- **Zero implicit access** — Vendors cannot read any patient data without a valid, non-expired, non-revoked consent token.
- **Immutable audit chain** — Every action is logged with chain-hash integrity verification for forensic accountability.
- **AI anomaly detection** — Rule-based behavioral analytics detect brute-force attacks, unusual access patterns, and out-of-scope data requests.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Patient (Browser)                    │
│            React + Tailwind + Zustand                    │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS / JWT
┌─────────────────────▼───────────────────────────────────┐
│                   HealthSecure API                       │
│              Node.js / Express + Helmet                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │  Auth    │ │ Identity │ │ Consent  │ │   Records  │ │
│  │ MFA/JWT  │ │ Health ID│ │ Engine   │ │ AES-256    │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘ │
│  ┌────────────────────────┐ ┌─────────────────────────┐ │
│  │  Immutable Audit Ledger│ │ Anomaly Detection Engine│ │
│  │  (chain-hash integrity)│ │  (behavioral analytics) │ │
│  └────────────────────────┘ └─────────────────────────┘ │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                   PostgreSQL 16                          │
│    Users | Vendors | EHR | Consent Tokens | Audit Logs  │
└─────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
healthcare_cybersecurity/
├── backend/
│   ├── src/
│   │   ├── controllers/         # Auth, Identity, Consent, Record, Audit, Analytics
│   │   ├── middleware/          # JWT auth, vendor auth, MFA guard
│   │   ├── routes/              # REST API route definitions
│   │   ├── database/            # DB connection pool
│   │   ├── utils/               # Logger, AES crypto, audit writer
│   │   └── server.js            # Express app entry point
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/               # Dashboard, Consent, Records, Audit, Profile
│   │   ├── components/          # Layout, Sidebar
│   │   ├── services/            # Axios API client with auto-refresh
│   │   └── store/               # Zustand auth state
│   ├── Dockerfile
│   └── package.json
├── database/
│   └── schema.sql               # PostgreSQL schema with tamper-protection rules
├── docker-compose.yml
└── PhD_Thesis_Professional_Cybersecurity_Healthcare.md
```

---

## Key Security Features

| Feature | Implementation |
|---|---|
| Lifetime Health ID | ABHA-style `ABHA-XXXX-XXXX-XXXX` auto-generated unique identifier |
| Password Security | bcrypt (12 rounds), account lockout after 5 failed attempts |
| Multi-Factor Auth | TOTP via authenticator app (RFC 6238), QR code setup |
| JWT Tokens | 15-minute access tokens + 7-day refresh tokens (rotated per session) |
| Consent Tokens | HMAC-SHA256 signed, time-limited, purpose-bound, immediately revocable |
| Data Encryption | AES-256-CBC with per-record random IV |
| Data Integrity | SHA-256 hash verification on every record read |
| Audit Chain | Chain-hash linked audit entries; `UPDATE`/`DELETE` blocked at DB level |
| API Security | Helmet.js CSP, HSTS, rate limiting (global + auth-specific), input validation |
| Anomaly Detection | Brute-force, unusual hours, high-volume access, out-of-scope token use |
| RBAC | Patient / Vendor / Admin role separation at middleware and route level |

---

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL 16 (or Docker)

### 1. Database

```bash
psql -U postgres -c "CREATE DATABASE healthcare_cybersec;"
psql -U postgres -d healthcare_cybersec -f database/schema.sql
```

### 2. Backend

```bash
cd backend
cp .env.example .env        # Edit secrets before running
npm install
npm run dev
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

### Docker (all-in-one)

```bash
# Set secrets in environment or .env file
export DB_PASSWORD=yourpassword
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_REFRESH_SECRET=$(openssl rand -hex 32)
export CONSENT_TOKEN_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 16)   # 32 chars

docker-compose up --build
```

Frontend: http://localhost:3000  
API: http://localhost:5000

---

## API Endpoints

### Authentication (`/api/v1/auth`)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/register` | Register patient, receive Lifetime Health ID |
| POST | `/login` | Login with email + password |
| POST | `/mfa/verify` | Verify TOTP code after login |
| POST | `/mfa/setup` | Setup authenticator app (returns QR) |
| POST | `/mfa/confirm` | Activate MFA after scanning QR |
| POST | `/refresh` | Refresh access token |
| POST | `/logout` | Invalidate session |

### Consent (`/api/v1/consent`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/request` | Vendor API Key | Vendor requests patient consent |
| GET | `/my/requests` | Patient JWT | Get all consent requests |
| POST | `/requests/:id/approve` | Patient JWT + MFA | Approve and issue consent token |
| POST | `/requests/:id/deny` | Patient JWT + MFA | Deny request |
| GET | `/my/active` | Patient JWT | Get active consents |
| POST | `/tokens/:ref/revoke` | Patient JWT | Revoke consent immediately |
| POST | `/validate` | Vendor API Key | Validate token before data access |

### Records (`/api/v1/records`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/my` | Patient JWT | List patient's records |
| GET | `/my/:id` | Patient JWT | Get record with decrypted data |
| POST | `/create` | Vendor API Key | Upload new health record |
| POST | `/access` | Vendor API Key | Access records with consent token |

---

## Research Alignment

This implementation directly validates the PhD thesis propositions:

1. **Lifetime Identity Continuity** → `users.health_id` persists across all vendor interactions
2. **Consent-Bound Sharing** → `consent_tokens` enforce purpose, scope, and time limits
3. **Hybrid RBAC-ABAC** → Role (Patient/Vendor/Admin) + attribute checks (token validity, scope, urgency)
4. **AI-Based Anomaly Detection** → `analytics.controller.js` runs behavioral rule engine
5. **Immutable Audit Ledger** → PostgreSQL rules block UPDATE/DELETE on `audit_logs`; chain-hash integrity

---

## License

Academic research project. Not for production clinical use without formal security audit and regulatory compliance review.
