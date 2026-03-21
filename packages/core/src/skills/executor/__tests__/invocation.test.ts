import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SkillInvocationManager, SkillPolicyDeniedError } from '../invocation.js'
import { PolicyEngine } from '../../policy/engine.js'
import type { SkillInvocationStore, SkillInvocation, SkillArtifact } from '../types.js'
import type { CapabilityScope, SkillPolicy } from '../../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** In-memory store for tests */
function makeStore(): SkillInvocationStore {
  const map = new Map<string, SkillInvocation>()
  return {
    save(invocation: SkillInvocation): void {
      map.set(invocation.id, structuredClone(invocation))
    },
    get(invocationId: string): SkillInvocation | null {
      return map.get(invocationId) ?? null
    },
    listByJob(jobId: string): SkillInvocation[] {
      return [...map.values()].filter((inv) => inv.jobId === jobId)
    },
  }
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}

/** Policy that allows fs.read only (mirrors Phase C behavior) */
const READ_ONLY_POLICY: SkillPolicy = {
  defaultAction: 'deny',
  rules: [{ capability: 'fs.read', action: 'allow' }],
  maxExecutionMs: 30_000,
  networkAllowed: false,
}

/** Policy that requires approval for fs.write */
const WRITE_APPROVAL_POLICY: SkillPolicy = {
  defaultAction: 'deny',
  rules: [
    { capability: 'fs.read', action: 'allow' },
    { capability: 'fs.write', action: 'require_approval' },
  ],
  maxExecutionMs: 30_000,
  networkAllowed: false,
}

/** Policy that allows everything */
const ALLOW_ALL_POLICY: SkillPolicy = {
  defaultAction: 'deny',
  rules: [
    { capability: 'fs.read', action: 'allow' },
    { capability: 'fs.write', action: 'allow' },
    { capability: 'proc.spawn', action: 'allow' },
    { capability: 'net.http', action: 'allow' },
    { capability: 'secrets.read', action: 'allow' },
  ],
  maxExecutionMs: 30_000,
  networkAllowed: true,
}

/** Helper to call manager.create with the 8-arg signature */
function createInvocation(
  manager: SkillInvocationManager,
  jobId: string,
  roundIndex: number,
  agentId: string,
  capabilityScopes: CapabilityScope[],
  input: Record<string, unknown> = {},
  skillId: string = 'test-skill',
  skillVersion: string = '1.0.0',
  policy?: SkillPolicy,
): SkillInvocation {
  return manager.create(
    jobId,
    roundIndex,
    agentId,
    skillId,
    skillVersion,
    capabilityScopes,
    input,
    policy ?? READ_ONLY_POLICY,
  )
}

// ---------------------------------------------------------------------------
// SkillInvocationManager
// ---------------------------------------------------------------------------

describe('SkillInvocationManager', () => {
  let store: SkillInvocationStore
  let logger: ReturnType<typeof makeLogger>
  let engine: PolicyEngine
  let manager: SkillInvocationManager

  beforeEach(() => {
    store = makeStore()
    logger = makeLogger()
    engine = new PolicyEngine()
    manager = new SkillInvocationManager(store, engine, logger)
  })

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('creates invocation with status pending when capabilities are fs.read only', () => {
      const invocation = createInvocation(
        manager,
        'job-1',
        0,
        'agent-1',
        [{ capability: 'fs.read', scope: ['./src/**'] }],
        { path: '/src' },
      )

      expect(invocation.status).toBe('pending')
      expect(invocation.jobId).toBe('job-1')
      expect(invocation.roundIndex).toBe(0)
      expect(invocation.agentId).toBe('agent-1')
      expect(invocation.skillId).toBe('test-skill')
      expect(invocation.resolvedVersion).toBe('1.0.0')
      expect(invocation.input).toEqual({ path: '/src' })
      expect(invocation.artifacts).toEqual([])
      expect(invocation.timestamps.createdAt).toBeTruthy()
      expect(invocation.timestamps.startedAt).toBeUndefined()
      expect(invocation.timestamps.completedAt).toBeUndefined()
    })

    it('throws SkillPolicyDeniedError when capability is denied by policy', () => {
      expect(() =>
        createInvocation(manager, 'job-1', 0, 'agent-1', [
          { capability: 'fs.write', scope: ['./src/**'] },
        ]),
      ).toThrow(SkillPolicyDeniedError)
    })

    it('throws SkillPolicyDeniedError for net.http with read-only policy', () => {
      expect(() =>
        createInvocation(manager, 'job-1', 0, 'agent-1', [
          { capability: 'net.http', scope: ['api.example.com'] },
        ]),
      ).toThrow(SkillPolicyDeniedError)
    })

    it('throws SkillPolicyDeniedError for proc.spawn with read-only policy', () => {
      expect(() =>
        createInvocation(manager, 'job-1', 0, 'agent-1', [
          { capability: 'proc.spawn', scope: ['npm test'] },
        ]),
      ).toThrow(SkillPolicyDeniedError)
    })

    it('allows empty capabilities (no capabilities = allowed)', () => {
      const invocation = createInvocation(manager, 'job-1', 0, 'agent-1', [])

      expect(invocation.status).toBe('pending')
      expect(invocation.id).toBeTruthy()
    })

    it('generates unique IDs for each invocation', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const invocation = createInvocation(manager, 'job-1', i, 'agent-1', [
          { capability: 'fs.read', scope: [] },
        ])
        ids.add(invocation.id)
      }

      expect(ids.size).toBe(100)
    })

    it('saves created invocation to the store', () => {
      const invocation = createInvocation(manager, 'job-1', 0, 'agent-1', [
        { capability: 'fs.read', scope: [] },
      ])
      const stored = store.get(invocation.id)

      expect(stored).not.toBeNull()
      expect(stored!.id).toBe(invocation.id)
      expect(stored!.status).toBe('pending')
    })

    it('stores policy evaluations on the invocation', () => {
      const invocation = createInvocation(manager, 'job-1', 0, 'agent-1', [
        { capability: 'fs.read', scope: ['./src/**'] },
      ])

      expect(invocation.policyEvaluations).toBeDefined()
      expect(invocation.policyEvaluations).toHaveLength(1)
      expect(invocation.policyEvaluations![0].capability).toBe('fs.read')
      expect(invocation.policyEvaluations![0].action).toBe('allow')
    })
  })

  // -------------------------------------------------------------------------
  // Approval flow (Phase D)
  // -------------------------------------------------------------------------

  describe('approval flow', () => {
    it('creates invocation with awaiting_approval when policy requires approval', () => {
      const invocation = createInvocation(
        manager,
        'job-1',
        0,
        'agent-1',
        [{ capability: 'fs.write', scope: ['./src/**'] }],
        {},
        'write-skill',
        '1.0.0',
        WRITE_APPROVAL_POLICY,
      )

      expect(invocation.status).toBe('awaiting_approval')
      expect(invocation.policyEvaluations).toBeDefined()
      const writeEval = invocation.policyEvaluations!.find((e) => e.capability === 'fs.write')
      expect(writeEval?.action).toBe('require_approval')
    })

    it('markApproved transitions from awaiting_approval to pending', () => {
      const invocation = createInvocation(
        manager,
        'job-1',
        0,
        'agent-1',
        [{ capability: 'fs.write', scope: ['./src/**'] }],
        {},
        'write-skill',
        '1.0.0',
        WRITE_APPROVAL_POLICY,
      )

      manager.markApproved(invocation.id)

      const updated = store.get(invocation.id)
      expect(updated!.status).toBe('pending')
    })

    it('markApproved with editedInput updates the input', () => {
      const invocation = createInvocation(
        manager,
        'job-1',
        0,
        'agent-1',
        [{ capability: 'fs.write', scope: ['./src/**'] }],
        { path: './src/old.ts' },
        'write-skill',
        '1.0.0',
        WRITE_APPROVAL_POLICY,
      )

      manager.markApproved(invocation.id, { path: './src/new.ts' })

      const updated = store.get(invocation.id)
      expect(updated!.status).toBe('pending')
      expect(updated!.input).toEqual({ path: './src/new.ts' })
    })

    it('markRejected transitions from awaiting_approval to rejected', () => {
      const invocation = createInvocation(
        manager,
        'job-1',
        0,
        'agent-1',
        [{ capability: 'fs.write', scope: ['./src/**'] }],
        {},
        'write-skill',
        '1.0.0',
        WRITE_APPROVAL_POLICY,
      )

      manager.markRejected(invocation.id, 'Not needed')

      const updated = store.get(invocation.id)
      expect(updated!.status).toBe('rejected')
      expect(updated!.error).toBe('Not needed')
      expect(updated!.timestamps.completedAt).toBeTruthy()
    })

    it('markRejected throws on non-awaiting_approval status', () => {
      const invocation = createInvocation(manager, 'job-1', 0, 'agent-1', [
        { capability: 'fs.read', scope: [] },
      ])

      expect(() => manager.markRejected(invocation.id)).toThrow(/expected 'awaiting_approval'/)
    })

    it('markApproved throws on non-awaiting_approval status', () => {
      const invocation = createInvocation(manager, 'job-1', 0, 'agent-1', [
        { capability: 'fs.read', scope: [] },
      ])

      expect(() => manager.markApproved(invocation.id)).toThrow(/expected 'awaiting_approval'/)
    })

    it('deny overrides require_approval when mixed capabilities', () => {
      // Policy allows fs.read, requires approval for fs.write, denies net.http
      const mixedPolicy: SkillPolicy = {
        defaultAction: 'deny',
        rules: [
          { capability: 'fs.read', action: 'allow' },
          { capability: 'fs.write', action: 'require_approval' },
        ],
        maxExecutionMs: 30_000,
        networkAllowed: false,
      }

      // Requesting fs.write (require_approval) + net.http (denied) → overall deny
      expect(() =>
        createInvocation(
          manager,
          'job-1',
          0,
          'agent-1',
          [
            { capability: 'fs.write', scope: ['./src/**'] },
            { capability: 'net.http', scope: ['api.example.com'] },
          ],
          {},
          'mixed-skill',
          '1.0.0',
          mixedPolicy,
        ),
      ).toThrow(SkillPolicyDeniedError)
    })
  })

  // -------------------------------------------------------------------------
  // markRunning
  // -------------------------------------------------------------------------

  describe('markRunning', () => {
    it('sets status to running and records startedAt timestamp', () => {
      const invocation = createInvocation(manager, 'job-1', 0, 'agent-1', [
        { capability: 'fs.read', scope: [] },
      ])

      manager.markRunning(invocation.id)

      const updated = store.get(invocation.id)
      expect(updated).not.toBeNull()
      expect(updated!.status).toBe('running')
      expect(updated!.timestamps.startedAt).toBeTruthy()
      expect(new Date(updated!.timestamps.startedAt!).toISOString()).toBe(
        updated!.timestamps.startedAt,
      )
    })
  })

  // -------------------------------------------------------------------------
  // markCompleted
  // -------------------------------------------------------------------------

  describe('markCompleted', () => {
    it('sets status to completed with artifacts, durationMs, and completedAt', () => {
      const invocation = createInvocation(manager, 'job-1', 0, 'agent-1', [
        { capability: 'fs.read', scope: [] },
      ])
      manager.markRunning(invocation.id)

      const artifacts: SkillArtifact[] = [
        {
          type: 'finding',
          name: 'test-finding',
          content: 'Found something interesting',
          includeInContext: true,
        },
        {
          type: 'metric',
          name: 'line-count',
          content: { lines: 42 },
          includeInContext: false,
        },
      ]

      manager.markCompleted(invocation.id, artifacts, 1500)

      const updated = store.get(invocation.id)
      expect(updated).not.toBeNull()
      expect(updated!.status).toBe('completed')
      expect(updated!.artifacts).toEqual(artifacts)
      expect(updated!.durationMs).toBe(1500)
      expect(updated!.timestamps.completedAt).toBeTruthy()
      expect(new Date(updated!.timestamps.completedAt!).toISOString()).toBe(
        updated!.timestamps.completedAt,
      )
    })
  })

  // -------------------------------------------------------------------------
  // markFailed
  // -------------------------------------------------------------------------

  describe('markFailed', () => {
    it('sets status to failed with error and completedAt', () => {
      const invocation = createInvocation(manager, 'job-1', 0, 'agent-1', [
        { capability: 'fs.read', scope: [] },
      ])
      manager.markRunning(invocation.id)

      manager.markFailed(invocation.id, 'Connection timed out after 30000ms')

      const updated = store.get(invocation.id)
      expect(updated).not.toBeNull()
      expect(updated!.status).toBe('failed')
      expect(updated!.error).toBe('Connection timed out after 30000ms')
      expect(updated!.timestamps.completedAt).toBeTruthy()
      expect(new Date(updated!.timestamps.completedAt!).toISOString()).toBe(
        updated!.timestamps.completedAt,
      )
    })
  })

  // -------------------------------------------------------------------------
  // System rules integration
  // -------------------------------------------------------------------------

  describe('system rules', () => {
    it('blocks SSRF via system rules even when policy allows net.http', () => {
      expect(() =>
        createInvocation(
          manager,
          'job-1',
          0,
          'agent-1',
          [{ capability: 'net.http', scope: ['127.0.0.1'] }],
          {},
          'ssrf-skill',
          '1.0.0',
          ALLOW_ALL_POLICY,
        ),
      ).toThrow(SkillPolicyDeniedError)
    })

    it('blocks metadata endpoint even when policy allows net.http', () => {
      expect(() =>
        createInvocation(
          manager,
          'job-1',
          0,
          'agent-1',
          [{ capability: 'net.http', scope: ['169.254.169.254'] }],
          {},
          'meta-skill',
          '1.0.0',
          ALLOW_ALL_POLICY,
        ),
      ).toThrow(SkillPolicyDeniedError)
    })

    it('allows external domains when policy allows net.http', () => {
      const invocation = createInvocation(
        manager,
        'job-1',
        0,
        'agent-1',
        [{ capability: 'net.http', scope: ['api.example.com'] }],
        {},
        'api-skill',
        '1.0.0',
        ALLOW_ALL_POLICY,
      )

      expect(invocation.status).toBe('pending')
    })
  })
})
