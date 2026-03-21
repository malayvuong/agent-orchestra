import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryInvocationStore } from '../store.js'
import type { SkillInvocation } from '../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeInvocation(overrides: Partial<SkillInvocation> = {}): SkillInvocation {
  return {
    id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobId: 'job-1',
    roundIndex: 0,
    agentId: 'agent-1',
    skillId: 'test-skill',
    resolvedVersion: '1.0.0',
    input: {},
    status: 'pending',
    artifacts: [],
    timestamps: {
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// InMemoryInvocationStore
// ---------------------------------------------------------------------------

describe('InMemoryInvocationStore', () => {
  let store: InMemoryInvocationStore

  beforeEach(() => {
    store = new InMemoryInvocationStore()
  })

  describe('save and get', () => {
    it('round-trips an invocation through save and get', () => {
      const invocation = makeInvocation({
        id: 'inv-001',
        jobId: 'job-1',
        skillId: 'dep-audit',
        status: 'pending',
        input: { path: '/src' },
      })

      store.save(invocation)
      const retrieved = store.get('inv-001')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('inv-001')
      expect(retrieved!.jobId).toBe('job-1')
      expect(retrieved!.skillId).toBe('dep-audit')
      expect(retrieved!.status).toBe('pending')
      expect(retrieved!.input).toEqual({ path: '/src' })
    })

    it('overwrites an existing invocation on re-save', () => {
      const invocation = makeInvocation({ id: 'inv-001', status: 'pending' })
      store.save(invocation)

      const updated = { ...invocation, status: 'running' as const }
      store.save(updated)

      const retrieved = store.get('inv-001')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.status).toBe('running')
    })

    it('stores multiple invocations independently', () => {
      const inv1 = makeInvocation({ id: 'inv-001', skillId: 'skill-a' })
      const inv2 = makeInvocation({ id: 'inv-002', skillId: 'skill-b' })

      store.save(inv1)
      store.save(inv2)

      expect(store.get('inv-001')!.skillId).toBe('skill-a')
      expect(store.get('inv-002')!.skillId).toBe('skill-b')
    })
  })

  describe('get', () => {
    it('returns null for a nonexistent invocation ID', () => {
      const result = store.get('nonexistent-id')
      expect(result).toBeNull()
    })

    it('returns null when the store is empty', () => {
      const result = store.get('any-id')
      expect(result).toBeNull()
    })
  })

  describe('listByJob', () => {
    it('returns invocations filtered by job ID', () => {
      store.save(makeInvocation({ id: 'inv-1', jobId: 'job-alpha' }))
      store.save(makeInvocation({ id: 'inv-2', jobId: 'job-beta' }))
      store.save(makeInvocation({ id: 'inv-3', jobId: 'job-alpha' }))
      store.save(makeInvocation({ id: 'inv-4', jobId: 'job-gamma' }))
      store.save(makeInvocation({ id: 'inv-5', jobId: 'job-alpha' }))

      const results = store.listByJob('job-alpha')

      expect(results).toHaveLength(3)
      const ids = results.map((r) => r.id)
      expect(ids).toContain('inv-1')
      expect(ids).toContain('inv-3')
      expect(ids).toContain('inv-5')
    })

    it('returns empty array for an unknown job ID', () => {
      store.save(makeInvocation({ id: 'inv-1', jobId: 'job-alpha' }))

      const results = store.listByJob('nonexistent-job')

      expect(results).toEqual([])
    })

    it('returns empty array when the store is empty', () => {
      const results = store.listByJob('any-job')
      expect(results).toEqual([])
    })

    it('does not return invocations from other jobs', () => {
      store.save(makeInvocation({ id: 'inv-1', jobId: 'job-a' }))
      store.save(makeInvocation({ id: 'inv-2', jobId: 'job-b' }))

      const results = store.listByJob('job-a')

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('inv-1')
    })
  })
})
