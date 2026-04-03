import type { JobStatus } from '../types/job.js'
import type { RoundState } from '../types/protocol.js'
import type { AgentOutput } from '../types/output.js'
import type { FindingCluster } from '../types/protocol.js'

/** Spec v1.3 SS12.1 — Event types emitted during orchestration. */

export type JobUpdateEvent = {
  type: 'job:update'
  jobId: string
  status: JobStatus
  timestamp: string
}

export type RoundStartEvent = {
  type: 'round:start'
  jobId: string
  roundIndex: number
  state: RoundState
  timestamp: string
}

export type RoundCompleteEvent = {
  type: 'round:complete'
  jobId: string
  roundIndex: number
  state: RoundState
  timestamp: string
}

export type AgentOutputEvent = {
  type: 'agent:output'
  jobId: string
  agentId: string
  chunk: string
  timestamp: string
}

export type AgentOutputEndEvent = {
  type: 'agent:output:end'
  jobId: string
  agentId: string
  output: AgentOutput
  timestamp: string
}

export type ClusterUpdateEvent = {
  type: 'cluster:update'
  jobId: string
  clusters: FindingCluster[]
  timestamp: string
}

export type SynthesisReadyEvent = {
  type: 'synthesis:ready'
  jobId: string
  timestamp: string
}

export type ErrorEvent = {
  type: 'error'
  jobId: string
  error: string
  details?: unknown
  timestamp: string
}

/** Union of all orchestration events. */
export type OrchestraEvent =
  | JobUpdateEvent
  | RoundStartEvent
  | RoundCompleteEvent
  | AgentOutputEvent
  | AgentOutputEndEvent
  | ClusterUpdateEvent
  | SynthesisReadyEvent
  | ErrorEvent

/** Map from event type string to its payload type. */
export type EventMap = {
  'job:update': JobUpdateEvent
  'round:start': RoundStartEvent
  'round:complete': RoundCompleteEvent
  'agent:output': AgentOutputEvent
  'agent:output:end': AgentOutputEndEvent
  'cluster:update': ClusterUpdateEvent
  'synthesis:ready': SynthesisReadyEvent
  error: ErrorEvent
}

/** Valid event type names. */
export type EventType = keyof EventMap

/** Alias for use with generic EventBus<TMap>. */
export type DebateEventMap = EventMap
