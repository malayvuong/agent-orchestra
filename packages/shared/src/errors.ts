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

/**
 * Thrown when Docker (or compatible container runtime) is not available
 * on the host system. Plugin-type skills require a container runtime
 * for sandboxed execution.
 */
export class SandboxUnavailableError extends AgentOrchestraError {
  constructor(message?: string) {
    super(
      message ??
        'Docker is required for plugin skill execution. ' +
          'Install Docker or use --skip-plugins flag.',
      'SANDBOX_UNAVAILABLE',
    )
    this.name = 'SandboxUnavailableError'
  }
}
