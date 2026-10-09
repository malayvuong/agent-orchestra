import type { ContextBudgetManager } from '../interfaces/context-budget-manager.js'
import type { OutputNormalizer } from '../interfaces/output-normalizer.js'
import type { CancellationRegistry } from '../interfaces/cancellation-registry.js'
import type { ContextBuilder } from '../context/context-builder.js'
import type { SkillDefinition } from '../skills/types.js'
import type { Finding } from './finding.js'
import type { ApplySummary } from './protocol.js'

export type ReviewAssessmentState = {
  previousFindings: Finding[]
  currentFindings: Finding[]
  architectResponse: string
  reviewerResponse: string
  applySummary?: ApplySummary
}

export type ReviewAssessment = {
  choice: 'continue' | 'stop' | 'needs_attention'
  confidence: number
  probabilities: Record<'continue' | 'stop' | 'needs_attention', number>
  unresolvedRisk: number
  model: string
  inputTokens: number
  latencyMs: number
}

/**
 * Spec v1.3 §8.2 — Dependencies injected into ProtocolRunner.execute().
 * Interfaces that exist in core are typed; others remain unknown until their packages are built.
 */
export type ProtocolExecutionDeps = {
  reviewAssessor?: { assess(state: ReviewAssessmentState): Promise<ReviewAssessment> }
  providerExecutor: unknown
  contextBuilder: ContextBuilder
  outputNormalizer: OutputNormalizer
  scopeGuard: unknown
  clusteringEngine: unknown
  synthesisEngine: unknown
  roundStore: unknown
  jobStore: unknown
  eventBus: unknown
  cancellationRegistry: CancellationRegistry
  budgetManager: ContextBudgetManager
  resolvedSkills: SkillDefinition[]
  conversationStore: unknown
}
