import type { Finding } from './finding.js'

/** Spec v1.3 §4.10 */
export type AgentOutput = {
  rawText: string
  structuredSections: Record<string, string>
  findings: Finding[]
  warnings: string[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cost?: number
    latencyMs?: number
  }
}

/** Spec v1.3 §4.11 */
export type ProviderOutput = {
  rawText: string
  structuredSections?: Record<string, unknown>
  warnings?: string[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cost?: number
    latencyMs?: number
  }
  exitCode?: number
  stderrText?: string
}

/** Spec v1.3 §7.3 */
export type NormalizationResult = {
  output: AgentOutput
  warnings: string[]
  malformed: boolean
  malformedReason?: string
}
