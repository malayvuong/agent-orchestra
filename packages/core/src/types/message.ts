import type { AgentRole } from './agent.js'
import type { RoundState } from './protocol.js'
import type { Finding } from './finding.js'

/** A block of text content within an agent message. */
export type TextBlock = { type: 'text'; text: string }

/** A block wrapping a single finding within an agent message. */
export type FindingBlock = { type: 'finding'; finding: Finding }

/** Discriminated union of content blocks. Extend with ToolCallBlock etc. later. */
export type ContentBlock = TextBlock | FindingBlock

/**
 * A structured message in the per-job conversation log.
 *
 * Written by the protocol runner after each agent call.
 * Provides identity, metadata, and typed content blocks
 * that replace the unstructured debateHistory: string[].
 */
export type AgentMessage = {
  id: string
  jobId: string
  roundIndex: number
  sender: string
  role: AgentRole
  state: RoundState
  timestamp: string
  contentBlocks: ContentBlock[]
  findingCount: number
  warnings?: string[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    latencyMs?: number
  }
}
