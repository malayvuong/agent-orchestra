import type { AgentAssignment } from '../types/agent.js'
import type { AgentContext } from '../types/context.js'
import type { Job } from '../types/job.js'
import type { SkillDefinition } from '../skills/types.js'
import type { ContextBudgetManager } from '../interfaces/context-budget-manager.js'
import type { TokenEstimator } from '../interfaces/token-estimator.js'
import type { SkillMatcher } from '../skills/matcher.js'
import type { SkillInjector } from '../skills/injector.js'
import type { SessionState, TaskState, RunRecord } from '../types/runtime.js'
import type { AutomationJobDefinition } from '../runner/types.js'

const DEFAULT_TOKEN_LIMIT = 16_000
const DEFAULT_SKILL_BUDGET_PERCENT = 20

/**
 * Assembles AgentContext for a given agent and job.
 * Spec v1.3 §20.2 — must call ContextBudgetManager.fitToLimit() before returning.
 *
 * Task 1.5: Now skill-aware — matches skills for the agent and injects skill
 * context using SkillInjector with progressive disclosure.
 */
export class ContextBuilder {
  constructor(
    private budgetManager: ContextBudgetManager,
    private tokenEstimator: TokenEstimator,
    private skillMatcher: SkillMatcher,
    private skillInjector: SkillInjector,
  ) {}

  buildFor(
    agent: AgentAssignment,
    job: Job,
    options?: {
      skills?: SkillDefinition[]
      lifecyclePoint?: string
      tokenLimit?: number
    },
  ): AgentContext {
    const tokenLimit = options?.tokenLimit ?? DEFAULT_TOKEN_LIMIT

    // 1. Assemble base AgentContext from agent + job data
    const context: AgentContext = {
      role: agent.role,
      mode: job.mode,
      pinned: {
        brief: job.brief,
        scope: job.scope,
        decisionLog: job.decisionLog,
        protocol: job.protocol,
      },
      dynamic: {},
      evidence: [],
    }

    // 2. Inject skill context if skills are provided
    if (options?.skills && options.skills.length > 0) {
      const matchResult = this.skillMatcher.match(options.skills, agent, {
        jobBrief: job.brief,
        primaryTargets: job.scope.primaryTargets,
        lifecyclePoint: options.lifecyclePoint,
      })

      if (matchResult.matched.length > 0) {
        const skillBudgetPercent =
          job.runtimeConfig.skillBudgetPercent ?? DEFAULT_SKILL_BUDGET_PERCENT
        const skillBudgetTokens = Math.floor((skillBudgetPercent * tokenLimit) / 100)

        const { skillContext } = this.skillInjector.inject(matchResult, skillBudgetTokens)

        if (skillContext.length > 0) {
          context.skillContext = skillContext
        }
      }
    }

    // 3. Phase A: call fitToLimit (pass-through — full implementation in later phase)
    return this.budgetManager.fitToLimit(context, tokenLimit)
  }

  // ─── Phase 4: New context modes ──────────────────────────────────

  /**
   * Build context for interactive (non-debate) tasks.
   * Used by InteractiveRunner for direct model calls.
   */
  buildInteractiveContext(session: SessionState, task?: TaskState): InteractiveContext {
    return {
      sessionType: session.sessionType,
      taskState: task
        ? {
            taskId: task.taskId,
            title: task.title,
            objective: task.objective,
            executionRequired: task.executionRequired,
            status: task.status,
            lastEvidence: task.lastEvidence,
            blocker: task.blocker,
          }
        : undefined,
      policyFlags: session.policyContext,
      environmentFacts: this.gatherEnvironmentFacts(),
    }
  }

  /**
   * Build context for automation jobs.
   * Used by AutomationRunner for deterministic workflow execution.
   */
  buildAutomationContext(job: AutomationJobDefinition): AutomationContext {
    return {
      jobId: job.id,
      jobName: job.name,
      workflow: job.workflow.map((s) => ({
        id: s.id,
        type: s.type,
        name: s.name,
      })),
      lastRunStatus: job.lastRunStatus,
      schedule: job.schedule,
    }
  }

  /**
   * Build context for verification tasks.
   * Used when another agent claims "done" and a verifier checks evidence.
   */
  buildVerificationContext(task: TaskState, run: RunRecord): VerificationContext {
    return {
      taskId: task.taskId,
      objective: task.objective,
      toolCalls: run.toolCalls.map((tc) => ({
        name: tc.name,
        status: tc.status,
        summary: tc.summary,
      })),
      lastEvidence: task.lastEvidence,
    }
  }

  private gatherEnvironmentFacts(): Record<string, string> {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
    }
  }
}

// ─── Context types for new modes ─────────────────────────────────

export type InteractiveContext = {
  sessionType: string
  taskState?: {
    taskId: string
    title: string
    objective: string
    executionRequired: boolean
    status: string
    lastEvidence?: string
    blocker?: string
  }
  policyFlags?: string
  environmentFacts: Record<string, string>
}

export type AutomationContext = {
  jobId: string
  jobName: string
  workflow: Array<{ id: string; type: string; name: string }>
  lastRunStatus?: string
  schedule?: string
}

export type VerificationContext = {
  taskId: string
  objective: string
  toolCalls: Array<{
    name: string
    status: string
    summary?: string
  }>
  lastEvidence?: string
}
