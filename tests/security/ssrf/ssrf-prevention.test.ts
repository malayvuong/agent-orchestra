/**
 * SSRF prevention security tests.
 *
 * Verifies that the policy engine's URL validation blocks all
 * internal, loopback, link-local, and cloud metadata addresses
 * per the BLOCKED_NET_TARGETS list in the system rules.
 *
 * These tests validate the non-overridable system rules that
 * prevent Server-Side Request Forgery (SSRF) attacks.
 */

import { describe, it, expect } from 'vitest'
import { SYSTEM_RULES } from '../../../packages/core/src/skills/policy/system-rules.js'
import { BLOCKED_NET_TARGETS } from '../../../packages/core/src/skills/types.js'
import { validateUrl } from '../../../packages/core/src/skills/executor/transports/sse.js'
import { validateStreamableHttpUrl } from '../../../packages/core/src/skills/executor/transports/streamable-http.js'

describe('SSRF Prevention — System Rules', () => {
  it('SYSTEM_RULES contains a net.http rule blocking internal targets', () => {
    const netRule = SYSTEM_RULES.find((r) => r.capability === 'net.http')
    expect(netRule).toBeDefined()
    expect(netRule!.blockedScopes.length).toBeGreaterThan(0)
    expect(netRule!.reason).toContain('SSRF')
  })

  it('BLOCKED_NET_TARGETS includes all RFC1918, loopback, link-local, and metadata IPs', () => {
    const targets = [...BLOCKED_NET_TARGETS]
    expect(targets).toContain('127.0.0.0/8')
    expect(targets).toContain('10.0.0.0/8')
    expect(targets).toContain('172.16.0.0/12')
    expect(targets).toContain('192.168.0.0/16')
    expect(targets).toContain('169.254.169.254')
    expect(targets).toContain('localhost')
    expect(targets).toContain('0.0.0.0')
  })
})

describe('SSRF Prevention — SSE Transport URL Validation', () => {
  it('blocks 127.0.0.1 for net.http (loopback)', () => {
    expect(() => validateUrl('http://127.0.0.1:8080/api')).toThrow(/blocked/)
  })

  it('blocks 169.254.169.254 for net.http (cloud metadata)', () => {
    expect(() => validateUrl('http://169.254.169.254/latest/meta-data/')).toThrow(/blocked/)
  })

  it('blocks 10.0.0.1 for net.http (RFC1918 Class A)', () => {
    expect(() => validateUrl('http://10.0.0.1:3000/')).toThrow(/blocked/)
  })

  it('blocks 172.16.0.1 for net.http (RFC1918 Class B)', () => {
    expect(() => validateUrl('http://172.16.0.1/')).toThrow(/blocked/)
  })

  it('blocks 192.168.1.1 for net.http (RFC1918 Class C)', () => {
    expect(() => validateUrl('http://192.168.1.1:8443/')).toThrow(/blocked/)
  })

  it('blocks localhost for net.http', () => {
    expect(() => validateUrl('http://localhost:3000/')).toThrow(/blocked/)
  })

  it('allows external domain (api.example.com) when not in blocked list', () => {
    expect(() => validateUrl('https://api.example.com/v1/data')).not.toThrow()
  })
})

describe('SSRF Prevention — Streamable HTTP Transport URL Validation', () => {
  it('blocks 127.0.0.1 for net.http (loopback)', () => {
    expect(() => validateStreamableHttpUrl('http://127.0.0.1:8080/api')).toThrow(/blocked/)
  })

  it('blocks 169.254.169.254 for net.http (cloud metadata)', () => {
    expect(() => validateStreamableHttpUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      /blocked/,
    )
  })

  it('blocks 10.0.0.1 for net.http (RFC1918 Class A)', () => {
    expect(() => validateStreamableHttpUrl('http://10.0.0.1:3000/')).toThrow(/blocked/)
  })

  it('blocks 172.16.0.1 for net.http (RFC1918 Class B)', () => {
    expect(() => validateStreamableHttpUrl('http://172.16.0.1/')).toThrow(/blocked/)
  })

  it('blocks 192.168.1.1 for net.http (RFC1918 Class C)', () => {
    expect(() => validateStreamableHttpUrl('http://192.168.1.1:8443/')).toThrow(/blocked/)
  })

  it('blocks localhost for net.http', () => {
    expect(() => validateStreamableHttpUrl('http://localhost:3000/')).toThrow(/blocked/)
  })

  it('allows external domain (api.example.com) when not in blocked list', () => {
    expect(() => validateStreamableHttpUrl('https://api.example.com/v1/data')).not.toThrow()
  })
})
