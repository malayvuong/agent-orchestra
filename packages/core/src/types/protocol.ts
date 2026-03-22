import type { FindingScopeType } from './finding.js'
import type { AgentOutput } from './output.js'

/** Spec v1.3 §5.1 */
export type Protocol =
  | 'single_challenger'
  | 'reviewer_wave'
  | 'reviewer_wave_with_final_check'
  | 'builder_plus_reviewer'

/** Spec v1.3 §4.13 */
export type RoundState =
  | 'analysis'
  | 'review'
  | 'review_wave'
  | 'build'
  | 'cluster'
  | 'rebuttal'
  | 'final_check'
  | 'convergence'
  | 'apply'

/** Spec v1.3 §4.12 */
export type FindingClusterStatus = 'confirmed' | 'disputed' | 'needs_decision'
export type FindingCluster = {
  id: string
  theme: string
  scopeType: FindingScopeType
  linkedFindings: Array<{
    agentId: string
    findingId: string
    findingTitle: string
  }>
  status: FindingClusterStatus
}

/** Apply result summary for apply rounds */
export type ApplySummary = {
  attemptedFiles: string[]
  writtenFiles: string[]
  unchangedFiles: string[]
  skippedFiles: Array<{ path: string; reason: string }>
  errors: string[]
}

export type FinalCheckVerdict = 'improved' | 'mixed' | 'unchanged' | 'regressed'

export type FinalCheckSummary = {
  verdict: FinalCheckVerdict
  score?: number
  summary: string
  changedFiles: string[]
  unchangedFiles: string[]
  baselineFingerprint?: string
}

/** Spec v1.3 §4.14 */
export type Round = {
  id: string
  jobId: string
  index: number
  state: RoundState

  architectOutput?: AgentOutput
  reviewerOutputs: Array<{
    agentId: string
    output: AgentOutput
  }>
  builderOutput?: AgentOutput

  clusterOutput?: FindingCluster[]
  summary?: string
  createdAt: string

  /** Present only on apply rounds — records actual file write results */
  applySummary?: ApplySummary

  /** Present only on final_check rounds — compares final artifact vs original baseline */
  finalCheckSummary?: FinalCheckSummary
}

/** Spec v1.3 §4.6 */
export type DecisionEntrySource = 'user' | 'system'
export type DecisionEntry = {
  message: string
  createdAt: string
  source: DecisionEntrySource
}
export type DecisionLog = {
  lockedConstraints: DecisionEntry[]
  acceptedDecisions: DecisionEntry[]
  rejectedOptions: DecisionEntry[]
  unresolvedItems: DecisionEntry[]
}
