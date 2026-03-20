import type { AgentAssignment } from './agent.js'
import type { DecisionLog } from './protocol.js'
import type { Protocol } from './protocol.js'

/** Spec v1.3 §4.1 */
export type JobStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'awaiting_decision'
  | 'completed'
  | 'cancelled'
  | 'failed'

/** Spec v1.3 §4.2 */
export type JobMode = 'plan' | 'code_review' | 'execution_review'

/** Spec v1.3 §4.5 */
export type ReferenceDepth = 'same_file' | 'same_folder' | 'same_module' | 'repo'
export type OutOfScopeHandling = 'ignore' | 'note' | 'follow_up'
export type JobScope = {
  primaryTargets: string[]
  excludedTargets: string[]
  referencePolicy: { enabled: boolean; depth: ReferenceDepth }
  outOfScopeHandling: OutOfScopeHandling
  allowDebateExpansion: false
}

/** Spec v1.3 §4.15 */
export type AwaitingDecisionReason = 'final_review' | 'pause_point' | 'manual_intervention'

/** Spec v1.3 §4.16 */
export type SynthesisConfig = {
  provider: 'architect_provider' | 'dedicated'
  dedicatedProviderKey?: string
  rerunnable: boolean
}
export type JobRuntimeConfig = {
  maxConcurrentAgents: number
  pausePointsEnabled: boolean
  synthesisConfig: SynthesisConfig

  /** Percentage of context budget allocated to skills (0-100, default: 20) (Task 1.1) */
  skillBudgetPercent?: number
}

/** Spec v1.3 §9.3 */
export type FailurePolicy = {
  reviewerFailure: 'continue_with_partial_results' | 'fail_job'
  architectFailure: 'fail_job'
  builderFailure: 'fail_job'
  maxRetriesPerAgent: number
  agentTimeoutMsDefault: number
}

/** Spec v1.3 §4.17 */
export type Job = {
  id: string
  title: string
  mode: JobMode
  brief: string

  status: JobStatus
  protocol: Protocol

  scope: JobScope
  decisionLog: DecisionLog

  agents: AgentAssignment[]

  currentRoundIndex: number
  maxRounds: number

  templateVersions: Record<string, number>
  runtimeConfig: JobRuntimeConfig

  awaitingDecisionReason?: AwaitingDecisionReason

  createdAt: string
  updatedAt: string

  failurePolicy?: FailurePolicy
}
