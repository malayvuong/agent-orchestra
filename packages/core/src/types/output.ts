import type { Finding } from './finding.js'
import type { ToolCall, SkillArtifact } from '../skills/executor/types.js'

/** Spec v1.3 §4.10 — extended in Phase C with toolCalls and skillArtifacts */
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
  /** Phase C: parsed tool calls from model output */
  toolCalls?: ToolCall[]
  /** Phase C: results from skill execution */
  skillArtifacts?: SkillArtifact[]
}

export type { ToolCall, SkillArtifact }

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
