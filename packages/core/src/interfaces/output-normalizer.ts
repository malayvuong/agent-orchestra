import type { AgentRole } from '../types/agent.js'
import type { NormalizationResult, ProviderOutput } from '../types/output.js'

/** Spec v1.3 §7.3 */
export interface OutputNormalizer {
  normalize(
    providerOutput: ProviderOutput,
    meta: { agentId: string; role: AgentRole; templateVersion: number },
  ): NormalizationResult
}
