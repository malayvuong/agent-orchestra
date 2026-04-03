---
name: OWASP Top 10
description: Comprehensive OWASP Top 10 security review guidelines
version: 2026.4.4
license: MIT
compatibility:
  agentOrchestra: ">=1.3.0"
  platforms:
    - darwin
    - linux
    - win32
triggers:
  lenses:
    - security
    - risk
  roles:
    - reviewer
  keywords:
    - owasp
    - vulnerability
    - injection
  lifecycle:
    - pre_round
    - post_synthesis
allowed-tools:
  - fs.read
---

# OWASP Top 10 Security Review

This skill provides comprehensive guidance for reviewing code against the OWASP Top 10 vulnerabilities.

## A01: Broken Access Control

Check that access control policies are enforced server-side. Verify that:
- Users cannot act outside their intended permissions
- Directory listings are disabled
- Access control failure logs are maintained

## A02: Cryptographic Failures

Review data classification and protection mechanisms:
- Identify sensitive data that requires encryption at rest and in transit
- Verify deprecated or weak cryptographic algorithms are not used
- Ensure proper key management practices are followed

## A03: Injection

Review all interpreter usage:
- SQL, NoSQL, OS, and LDAP injection vectors
- Validate all user-supplied data against an allowlist
- Use parameterized queries / prepared statements

## A04: Insecure Design

Assess the overall security design:
- Threat modelling performed during design
- Secure design patterns and reference architectures applied
- Unit and integration tests to validate all critical security controls
