/** Base error class for all agent-orchestra errors */
export class AgentOrchestraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'AgentOrchestraError'
  }
}

export class NotImplementedError extends AgentOrchestraError {
  constructor(feature: string) {
    super(`${feature} is not yet implemented`, 'NOT_IMPLEMENTED')
    this.name = 'NotImplementedError'
  }
}
