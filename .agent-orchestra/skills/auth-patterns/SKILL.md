---
name: Authentication & Authorization Patterns
description: Deep review of auth implementation — JWT lifecycle, OAuth flows, session management, RBAC enforcement, token storage, and common auth bypass vulnerabilities.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - security
    - logic
  keywords:
    - auth
    - jwt
    - oauth
    - session
    - token
    - rbac
    - login
    - password
---

When reviewing authentication and authorization code, apply the following checks.

## JWT Implementation

Verify tokens have an expiration claim (`exp`). Flag JWTs with expiration longer than 15 minutes for access tokens — use short-lived access tokens with refresh token rotation. Check that the `aud` (audience) and `iss` (issuer) claims are validated on every token verification, not just signature.

Flag JWT secrets stored in code or environment variables shorter than 256 bits. Flag `algorithm: 'none'` accepted by the verification library — this is the most common JWT bypass. Verify the algorithm is pinned at verification time (`algorithms: ['RS256']`), not inferred from the token header.

Flag JWTs stored in `localStorage` — they are accessible to XSS. Verify access tokens are stored in memory and refresh tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies. Flag tokens that contain sensitive data (email, roles, permissions) without encryption — JWTs are base64-encoded, not encrypted.

## Refresh Token Security

Verify refresh tokens are rotated on every use — the old token must be invalidated when a new one is issued. Flag refresh tokens without a family or lineage tracking mechanism — if a refresh token is reused after rotation, all tokens in the family must be revoked (token replay detection).

Check that refresh tokens have an absolute expiration (e.g., 7 days) independent of rotation. Flag refresh endpoints that do not verify the token was issued to the requesting client (device binding or client fingerprinting).

## OAuth Implementation

Verify PKCE (Proof Key for Code Exchange) is used for all public clients (SPAs, mobile apps). Flag the implicit grant flow — it exposes tokens in the URL fragment. Verify the `state` parameter is used and validated to prevent CSRF on the callback endpoint.

Check that the redirect URI is validated against a strict allowlist — not a prefix match or regex that could be bypassed. Flag `redirect_uri` validation that allows open redirects to attacker-controlled domains.

Verify authorization codes are single-use and expire within 60 seconds. Flag OAuth token endpoints that do not validate the `client_id` matches the original authorization request.

## Session Management

Verify session IDs are regenerated after authentication (login) to prevent session fixation. Flag sessions that persist the pre-authentication session ID. Check that session cookies have `HttpOnly`, `Secure`, and `SameSite` flags set.

Verify session expiration is enforced server-side — not just by cookie expiry. Flag sessions without idle timeout (user walks away, session stays valid forever). Check that logout invalidates the session on the server, not just deletes the client cookie.

## Authorization Enforcement

Verify authorization checks occur on every API endpoint, not just at the UI layer. Flag endpoints that check user role in the frontend but not in the backend — client-side role checks are decorative, not protective.

Check for IDOR (Insecure Direct Object Reference): flag endpoints where `GET /users/{id}` returns any user's data without verifying the requesting user has permission to access that specific resource. Verify object-level permissions are checked, not just role-level.

Flag authorization logic scattered across controllers — centralize in middleware or policy classes. Check that default authorization is deny — new endpoints should require explicit permission grants, not default to open.

## Password Handling

Verify passwords are hashed with bcrypt (cost factor >= 12), scrypt, or Argon2id — never MD5, SHA-1, or SHA-256 without a salt. Flag custom password hashing implementations — use the language's standard library or a well-audited library.

Check that password reset tokens are single-use, time-limited (< 1 hour), and cryptographically random (>= 128 bits). Flag password reset flows that reveal whether an email exists in the system — use a generic "if this email exists, we sent a link" response.

Verify password strength requirements are enforced server-side, not just client-side. Flag maximum password length limits below 64 characters — these suggest the password is not being hashed (hashing produces fixed-length output regardless of input length).

## Multi-Factor Authentication

Verify TOTP secrets are stored encrypted at rest, not in plaintext. Flag MFA bypass mechanisms that are too easy to trigger (security questions, SMS fallback without rate limiting). Check that MFA enrollment is required for privileged accounts.

Verify backup codes are single-use and hashed before storage. Flag MFA implementations that allow unlimited attempts without rate limiting or lockout.

For each finding, report: the file or endpoint, the specific auth pattern violated, the attack vector it enables, and the recommended fix.
