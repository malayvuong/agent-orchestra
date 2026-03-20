import type { AgentRole } from './agent.js'
import type { JobMode, JobScope } from './job.js'
import type { DecisionLog, FindingCluster, Protocol, Round } from './protocol.js'

/** Spec v1.3 §6.1 */
export type EvidencePacket = {
  path: string
  relation: 'primary' | 'reference'
  reason: string
  excerpt: string
}
export type AgentContext = {
  role: AgentRole
  mode: JobMode

  pinned: {
    brief: string
    scope: JobScope
    decisionLog: DecisionLog
    protocol: Protocol
  }

  dynamic: {
    currentRound?: Round
    previousRoundSummary?: string
    clusters?: FindingCluster[]
  }

  evidence: EvidencePacket[]

  /** Skill context injected by the skill system (Task 1.1) */
  skillContext?: string
}
