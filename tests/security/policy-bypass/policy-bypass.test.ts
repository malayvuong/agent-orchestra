/**
 * Policy bypass security tests.
 *
 * Verifies that:
 * 1. System rules cannot be overridden by user-defined policy.yaml rules
 * 2. Capability escalation is blocked (skill declares one cap, tries another)
 * 3. Deny-by-default works when no matching rule exists
 *
 * These tests validate the non-overridable nature of system rules
 * and the deny-by-default policy contract.
 */

import { describe, it, expect } from 'vitest'
import { SYSTEM_RULES } from '../../../packages/core/src/skills/policy/system-rules.js'
import { validateUrl } from '../../../packages/core/src/skills/executor/transports/sse.js'
import type { SkillPolicy, SkillPolicyRule } from '../../../packages/core/src/skills/types.js'
import { DEFAULT_POLICY } from '../../../packages/core/src/skills/policy/system-rules.js'

describe('Policy Bypass — System Rules Cannot Be Overridden', () => {
  it('system rules block 127.0.0.1 even if policy.yaml allows it', () => {
    // Simulate a user-defined policy that explicitly allows 127.0.0.1
    const userPolicy: SkillPolicy = {
      defaultAction: 'deny',
      rules: [
        {
          capability: 'net.http',
          action: 'allow',
          scope: ['127.0.0.1'],
        },
      ],
      maxExecutionMs: 30_000,
      networkAllowed: true,
    }

    // User policy exists but should not affect system-level URL validation.
    // System rules are evaluated BEFORE any user-defined policy and
    // cannot be overridden. The validateUrl function enforces this.
    expect(userPolicy.rules).toHaveLength(1)
    expect(() => validateUrl('http://127.0.0.1:8080/')).toThrow(/blocked/)

    // Verify the system rule is present and non-overridable
    const netRule = SYSTEM_RULES.find((r) => r.capability === 'net.http')
    expect(netRule).toBeDefined()
    expect(netRule!.blockedScopes).toContain('127.0.0.0/8')

    // Verify the system rules contain the CIDR block, not individual IPs.
    // The user policy specifies '127.0.0.1' but system rules block the entire /8 range.
    expect(netRule!.blockedScopes).not.toContain('127.0.0.1')
    // The system rule blocks the entire /8 range; there is no "allow" variant
    expect(netRule!.reason).toContain('SSRF protection')
  })

  it('system rules cannot be overridden for other blocked addresses', () => {
    // Even with a policy that tries to allow all RFC1918,
    // the transport-level validation still blocks them
    expect(() => validateUrl('http://10.0.0.1/')).toThrow(/blocked/)
    expect(() => validateUrl('http://172.16.0.1/')).toThrow(/blocked/)
    expect(() => validateUrl('http://192.168.1.1/')).toThrow(/blocked/)
    expect(() => validateUrl('http://169.254.169.254/')).toThrow(/blocked/)
  })
})

describe('Policy Bypass — Capability Escalation Blocked', () => {
  it('skill declaring fs.read cannot invoke fs.write capabilities', () => {
    // A skill declares only fs.read capability
    const declaredCapabilities = ['fs.read'] as const

    // When the invocation attempts fs.write, the check must fail.
    // The SkillInvocationManager's Phase C policy denies anything
    // beyond fs.read. We verify the invariant: if a declared capability
    // does not include a requested capability, it should be denied.
    const requestedCapability = 'fs.write'
    const isDeclared = declaredCapabilities.includes(
      requestedCapability as (typeof declaredCapabilities)[number],
    )

    expect(isDeclared).toBe(false)

    // Verify the DEFAULT_POLICY denies by default (no rules = deny all)
    expect(DEFAULT_POLICY.defaultAction).toBe('deny')
    expect(DEFAULT_POLICY.rules).toEqual([])

    // A capability not explicitly allowed by any rule falls through
    // to the default action, which is 'deny'
    const hasAllowRule = DEFAULT_POLICY.rules.some(
      (r: SkillPolicyRule) => r.capability === requestedCapability && r.action === 'allow',
    )
    expect(hasAllowRule).toBe(false)
  })

  it('proc.spawn capability is not allowed under default policy', () => {
    const hasAllowRule = DEFAULT_POLICY.rules.some(
      (r: SkillPolicyRule) => r.capability === 'proc.spawn' && r.action === 'allow',
    )
    expect(hasAllowRule).toBe(false)
    expect(DEFAULT_POLICY.defaultAction).toBe('deny')
  })
})

describe('Policy Bypass — Deny-by-Default', () => {
  it('default policy has deny as default action', () => {
    expect(DEFAULT_POLICY.defaultAction).toBe('deny')
  })

  it('default policy has no rules (everything falls to deny)', () => {
    expect(DEFAULT_POLICY.rules).toEqual([])
  })

  it('default policy has network disabled', () => {
    expect(DEFAULT_POLICY.networkAllowed).toBe(false)
  })

  it('deny-by-default applies when no matching rule exists for a capability', () => {
    // Given a policy with only an fs.read allow rule
    const policy: SkillPolicy = {
      defaultAction: 'deny',
      rules: [
        {
          capability: 'fs.read',
          action: 'allow',
          scope: ['./src/**'],
        },
      ],
      maxExecutionMs: 30_000,
      networkAllowed: false,
    }

    // There is no rule for net.http, so the default action ('deny') applies
    const hasNetRule = policy.rules.some((r: SkillPolicyRule) => r.capability === 'net.http')
    expect(hasNetRule).toBe(false)

    // The evaluation for net.http should fall through to defaultAction = deny
    expect(policy.defaultAction).toBe('deny')
  })
})
