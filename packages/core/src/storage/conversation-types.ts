import type { AgentMessage } from '../types/message.js'
import type { AgentRole } from '../types/agent.js'

/**
 * Store interface for the per-job conversation log.
 *
 * Append-only. Each protocol step appends one AgentMessage after
 * normalization. Reads support optional filtering by round and role.
 */
export interface ConversationStore {
  /** Append a message to the conversation log for its job. */
  append(message: AgentMessage): Promise<void>

  /**
   * Load all messages for a job, optionally filtered.
   * Returns [] for jobs with no conversation log.
   */
  loadByJob(
    jobId: string,
    filter?: {
      afterRound?: number
      role?: AgentRole
      sender?: string
    },
  ): Promise<AgentMessage[]>
}
