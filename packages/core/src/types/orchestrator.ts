/** Spec v1.3 §8.2 — Dependencies injected into ProtocolRunner.execute() */
export type ProtocolExecutionDeps = {
  providerExecutor: unknown
  contextBuilder: unknown
  outputNormalizer: unknown
  scopeGuard: unknown
  clusteringEngine: unknown
  synthesisEngine: unknown
  roundStore: unknown
  jobStore: unknown
  eventBus: unknown
  cancellationRegistry: unknown
}
