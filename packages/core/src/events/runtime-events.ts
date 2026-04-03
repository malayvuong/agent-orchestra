/** Runtime event types — independent of debate protocol. */

export type RunStartedEvent = {
  type: 'run:started'
  runId: string
  sessionId: string
  mode: string
  timestamp: string
}

export type RunCompletedEvent = {
  type: 'run:completed'
  runId: string
  sessionId: string
  status: 'completed' | 'failed' | 'cancelled'
  timestamp: string
}

export type TaskStatusEvent = {
  type: 'task:status'
  taskId: string
  status: string
  timestamp: string
}

export type GuardViolationEvent = {
  type: 'guard:violation'
  runId: string
  violationType: string
  message: string
  timestamp: string
}

export type RuntimeEventMap = {
  'run:started': RunStartedEvent
  'run:completed': RunCompletedEvent
  'task:status': TaskStatusEvent
  'guard:violation': GuardViolationEvent
}
