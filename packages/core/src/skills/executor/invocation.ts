import { randomUUID } from 'node:crypto'
import { AgentOrchestraError } from '@agent-orchestra/shared'
import type { CapabilityScope, SkillPolicy } from '../types.js'
import type { PolicyEvaluation } from '../policy/types.js'
import type { SkillArtifact, SkillInvocation, SkillInvocationStore } from './types.js'
import type { PolicyEngine } from '../policy/engine.js'
import { DEFAULT_POLICY } from '../policy/system-rules.js'

// ---------------------------------------------------------------------------
// Logger interface (minimal contract used throughout executor layer)
// ---------------------------------------------------------------------------

/** Logger interface for warnings and errors */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

// ---------------------------------------------------------------------------
// Custom error — policy denial
// ---------------------------------------------------------------------------

/**
 * Thrown when a skill invocation is denied by the policy engine.
 *
 * Phase C used a hardcoded check (only `fs.read` permitted).
 * Phase D uses the full PolicyEngine with configurable rules.
 */
export class SkillPolicyDeniedError extends AgentOrchestraError {
  constructor(message: string) {
    super(message, 'SKILL_POLICY_DENIED')
    this.name = 'SkillPolicyDeniedError'
  }
}

// ---------------------------------------------------------------------------
// Skill Invocation Manager
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of skill invocations.
 *
 * Responsibilities:
 * - Create invocations (with policy evaluation via PolicyEngine)
 * - Transition state: pending -> running -> completed | failed
 * - Support approval flow: awaiting_approval -> approved (resume) | rejected
 * - Delegate persistence to the injected `SkillInvocationStore`
 */
export class SkillInvocationManager {
  constructor(
    private readonly store: SkillInvocationStore,
    private readonly policyEngine: PolicyEngine,
    private readonly logger?: Logger,
  ) {}

  /**
   * Create a new invocation request.  Does **not** execute the skill.
   *
   * Evaluates the declared capability scopes against the provided policy
   * using the PolicyEngine:
   * - If ALL evaluations are `allow` → status `'pending'` (ready to run)
   * - If ANY evaluation is `require_approval` → status `'awaiting_approval'`
   * - If ANY evaluation is `deny` → throws {@link SkillPolicyDeniedError}
   *
   * Skills with no capability requirements are always allowed.
   *
   * @returns A `SkillInvocation` with the determined status.
   */
  create(
    jobId: string,
    roundIndex: number,
    agentId: string,
    skillId: string,
    skillVersion: string,
    capabilityScopes: CapabilityScope[],
    input: Record<string, unknown>,
    policy?: SkillPolicy,
  ): SkillInvocation {
    const effectivePolicy = policy ?? DEFAULT_POLICY

    // No capabilities required → always allowed
    let status: SkillInvocation['status'] = 'pending'
    let evaluations: PolicyEvaluation[] | undefined

    if (capabilityScopes.length > 0) {
      evaluations = this.policyEngine.evaluateInvocation(capabilityScopes, effectivePolicy)
      const overallAction = this.policyEngine.getOverallAction(evaluations)

      if (overallAction === 'deny') {
        const deniedEvals = evaluations.filter((e) => e.action === 'deny')
        const reasons = deniedEvals.map((e) => `${e.capability}: ${e.reason}`).join('; ')
        throw new SkillPolicyDeniedError(`Skill '${skillId}' denied by policy: ${reasons}`)
      }

      if (overallAction === 'require_approval') {
        status = 'awaiting_approval'
      }
    }

    const invocation: SkillInvocation = {
      id: randomUUID(),
      jobId,
      roundIndex,
      agentId,
      skillId,
      resolvedVersion: skillVersion,
      input,
      status,
      artifacts: [],
      policyEvaluations: evaluations,
      timestamps: {
        createdAt: new Date().toISOString(),
      },
    }

    this.store.save(invocation)
    this.logger?.warn?.(
      `Invocation ${invocation.id} created for skill ${skillId}@${skillVersion} (status: ${status})`,
    )

    return invocation
  }

  /**
   * Transition an invocation to `'running'` and record the start timestamp.
   */
  markRunning(invocationId: string): void {
    const invocation = this.getOrThrow(invocationId)
    invocation.status = 'running'
    invocation.timestamps.startedAt = new Date().toISOString()
    this.store.save(invocation)
  }

  /**
   * Transition an invocation to `'completed'`, storing artifacts and duration.
   */
  markCompleted(invocationId: string, artifacts: SkillArtifact[], durationMs: number): void {
    const invocation = this.getOrThrow(invocationId)
    invocation.status = 'completed'
    invocation.artifacts = artifacts
    invocation.durationMs = durationMs
    invocation.timestamps.completedAt = new Date().toISOString()
    this.store.save(invocation)
  }

  /**
   * Transition an invocation to `'failed'`, recording the error message.
   */
  markFailed(invocationId: string, error: string): void {
    const invocation = this.getOrThrow(invocationId)
    invocation.status = 'failed'
    invocation.error = error
    invocation.timestamps.completedAt = new Date().toISOString()
    this.store.save(invocation)
  }

  /**
   * Transition an invocation from `'awaiting_approval'` to `'rejected'`.
   * Called when the user rejects a pending approval.
   */
  markRejected(invocationId: string, reason?: string): void {
    const invocation = this.getOrThrow(invocationId)
    if (invocation.status !== 'awaiting_approval') {
      throw new AgentOrchestraError(
        `Cannot reject invocation ${invocationId}: status is '${invocation.status}', expected 'awaiting_approval'`,
        'INVALID_STATE_TRANSITION',
      )
    }
    invocation.status = 'rejected'
    invocation.error = reason ?? 'Rejected by user'
    invocation.timestamps.completedAt = new Date().toISOString()
    this.store.save(invocation)
  }

  /**
   * Transition an invocation from `'awaiting_approval'` to `'pending'`.
   * Called when the user approves a pending approval.
   * Optionally updates the input arguments (edit flow).
   */
  markApproved(invocationId: string, editedInput?: Record<string, unknown>): void {
    const invocation = this.getOrThrow(invocationId)
    if (invocation.status !== 'awaiting_approval') {
      throw new AgentOrchestraError(
        `Cannot approve invocation ${invocationId}: status is '${invocation.status}', expected 'awaiting_approval'`,
        'INVALID_STATE_TRANSITION',
      )
    }
    invocation.status = 'pending'
    if (editedInput !== undefined) {
      invocation.input = editedInput
    }
    this.store.save(invocation)
  }

  /**
   * Retrieve an invocation by ID, or return null if not found.
   */
  get(invocationId: string): SkillInvocation | null {
    return this.store.get(invocationId)
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private getOrThrow(invocationId: string): SkillInvocation {
    const invocation = this.store.get(invocationId)
    if (!invocation) {
      throw new AgentOrchestraError(`Invocation ${invocationId} not found`, 'INVOCATION_NOT_FOUND')
    }
    return invocation
  }
}
