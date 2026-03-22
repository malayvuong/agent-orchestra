# User Authentication System — Implementation Plan

## Goal
Add email/password authentication to the web application.

## Phase 1: Database Schema (Week 1)

### Step 1.1: Create users table migration
- Add columns: id, email (unique), password_hash, created_at, updated_at
- Add index on email column
- **Exit criteria:** Migration runs successfully, rollback works

### Step 1.2: Create sessions table migration
- Add columns: id, user_id (FK), token (unique), expires_at, created_at
- Add index on token column
- **Depends on:** Step 1.1
- **Exit criteria:** Migration runs, foreign key constraint verified

## Phase 2: Backend API (Week 2)

### Step 2.1: Registration endpoint
- POST /api/auth/register
- Input validation: email format, password strength (min 8 chars)
- Hash password with bcrypt (cost factor 12)
- Return user object (without password_hash)
- **Depends on:** Step 1.1
- **Exit criteria:** Integration tests pass, duplicate email returns 409

### Step 2.2: Login endpoint
- POST /api/auth/login
- Verify credentials, create session token
- Return token with expiry (24h default)
- **Depends on:** Steps 1.1, 1.2
- **Exit criteria:** Integration tests pass, invalid credentials return 401

### Step 2.3: Session middleware
- Validate session token on protected routes
- Reject expired tokens
- **Depends on:** Step 2.2
- **Exit criteria:** Protected routes return 401 without valid token

## Phase 3: Frontend (Week 3)

### Step 3.1: Login and registration forms
- React components with form validation
- Error message display
- **Depends on:** Steps 2.1, 2.2
- **Exit criteria:** Forms submit correctly, validation errors shown

### Step 3.2: Auth state management
- Store token in httpOnly cookie
- Auth context provider for React
- **Depends on:** Steps 2.3, 3.1
- **Exit criteria:** Login persists across page reloads

## Out of Scope
- OAuth / social login (deferred to Phase 2 of product roadmap)
- Two-factor authentication
- Password reset flow (separate ticket)
- Rate limiting (infrastructure-level, separate workstream)

## Risks
- **Password hashing performance:** bcrypt is intentionally slow; load test with expected registration volume
- **Session token storage:** httpOnly cookies mitigate XSS but require CSRF protection
- **Mitigation:** Add CSRF token to all state-changing requests in Phase 3
