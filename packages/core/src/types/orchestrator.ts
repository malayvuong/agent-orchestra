import type { ContextBudgetManager } from '../interfaces/context-budget-manager.js'
import type { OutputNormalizer } from '../interfaces/output-normalizer.js'
import type { CancellationRegistry } from '../interfaces/cancellation-registry.js'
import type { ContextBuilder } from '../context/context-builder.js'

/**
 * Spec v1.3 §8.2 — Dependencies injected into ProtocolRunner.execute().
 * Interfaces that exist in core are typed; others remain unknown until their packages are built.
 */
export type ProtocolExecutionDeps = {
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
}
