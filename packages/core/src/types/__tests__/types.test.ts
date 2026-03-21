import { describe, it, expect } from 'vitest'
import type { AgentRole, AgentLens, JobStatus, Finding } from '../index.js'

describe('Core types', () => {
  it('should allow valid AgentRole values', () => {
    const role: AgentRole = 'architect'
    expect(role).toBe('architect')
  })

  it('should allow valid AgentLens values', () => {
    const lens: AgentLens = 'security'
    expect(lens).toBe('security')
  })

  it('should allow valid JobStatus values', () => {
    const status: JobStatus = 'running'
    expect(status).toBe('running')
  })

  it('should allow valid Finding structure', () => {
    const finding: Finding = {
      id: 'f-1',
      title: 'Test finding',
      description: 'A test finding',
      scopeType: 'primary',
      actionability: 'must_fix_now',
      confidence: 'high',
    }
    expect(finding.id).toBe('f-1')
    expect(finding.scopeType).toBe('primary')
  })
})
