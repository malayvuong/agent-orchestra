// Debate events (backward compatible — same exports as before)
export type {
  JobUpdateEvent,
  RoundStartEvent,
  RoundCompleteEvent,
  AgentOutputEvent,
  AgentOutputEndEvent,
  ClusterUpdateEvent,
  SynthesisReadyEvent,
  ErrorEvent,
  OrchestraEvent,
  EventMap,
  EventType,
  DebateEventMap,
} from './debate-events.js'

// Runtime events
export type {
  RunStartedEvent,
  RunCompletedEvent,
  TaskStatusEvent,
  GuardViolationEvent,
  RuntimeEventMap,
} from './runtime-events.js'

// Composed map for consumers that need both debate and runtime events
import type { DebateEventMap } from './debate-events.js'
import type { RuntimeEventMap } from './runtime-events.js'
export type FullEventMap = DebateEventMap & RuntimeEventMap

// Classes
export { EventBus } from './event-bus.js'
export { PersistedEventBus } from './persisted-event-bus.js'
