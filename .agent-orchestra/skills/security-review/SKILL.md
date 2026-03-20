---
name: Security Review
description: OWASP Top 10 checklist for code review. Covers injection, broken auth, XSS, insecure deserialization, SSRF, and dependency vulnerabilities.
version: 1.0.0
license: MIT
triggers:
  lenses:
    - security
---

When reviewing code from a security perspective, apply the following OWASP Top 10 checks systematically.

## Injection (A03)

Check all locations where user-supplied data reaches a command interpreter or query engine. Look for SQL, NoSQL, OS command, LDAP, and XPath injection. Flag any string concatenation used to build queries or commands. Verify parameterized queries or prepared statements are used consistently. Check ORM usage for raw query escape hatches.

## Broken Authentication (A07)

Review session token generation for cryptographic strength. Verify passwords are hashed with bcrypt, scrypt, or Argon2 — never MD5 or SHA-1. Check for hard-coded credentials, API keys, or secrets in source files. Confirm multi-factor authentication paths cannot be bypassed. Verify session expiry is enforced server-side.

## Cross-Site Scripting (XSS) (A03)

Identify all locations where user input is reflected into HTML, JavaScript, or CSS. Confirm output encoding is applied before rendering. Flag uses of `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, or `eval` with external data. Check Content-Security-Policy headers are set appropriately.

## Insecure Deserialization (A08)

Flag any deserialization of data from untrusted sources (JSON.parse with no schema validation, pickle, Java ObjectInputStream, YAML.load with unsafe loader). Verify type and schema validation occurs before object construction. Check that deserialized data cannot trigger remote code execution through magic methods or gadget chains.

## Server-Side Request Forgery (SSRF) (A10)

Identify code that makes HTTP requests based on user-supplied URLs or hostnames. Verify allowlists are used rather than denylists. Check that internal metadata endpoints (169.254.169.254, localhost, 10.x, 172.16.x) are blocked. Flag any URL redirect chains that could be exploited.

## Vulnerable Dependencies (A06)

Note any direct use of third-party libraries with known CVEs. Flag outdated dependency versions. Verify `package-lock.json` or `pnpm-lock.yaml` is committed to prevent supply-chain substitution. Check that development dependencies cannot be loaded in production paths.

## Additional Checks

- Sensitive data exposure: verify PII, tokens, and credentials are not logged or returned in error responses.
- Security misconfiguration: check CORS policies, HTTP security headers, and default credentials.
- Broken access control: verify authorization checks occur on every sensitive operation, not just at the UI layer.

For each finding, report: the file and line range, the OWASP category, the specific risk, and a remediation recommendation.
