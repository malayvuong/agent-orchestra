import type { ProtocolRunner } from '../interfaces/protocol-runner.js'
import type { Protocol } from '../types/protocol.js'
import { SingleChallengerRunner } from './single-challenger.js'

/**
 * Registry mapping protocol names to their runner implementations.
 *
 * Spec v1.3 SS8.3 -- the Orchestrator uses this to look up the correct
 * ProtocolRunner for a job's protocol field.
 */
export class ProtocolRegistry {
  private readonly runners = new Map<string, ProtocolRunner>()

  constructor() {
    // Pre-register the built-in protocol runners
    this.register('single_challenger', new SingleChallengerRunner())
  }

  /** Register a protocol runner for a given protocol name. */
  register(protocolName: string, runner: ProtocolRunner): void {
    this.runners.set(protocolName, runner)
  }

  /**
   * Get the protocol runner for a given protocol name.
   * Throws if no runner is registered for the name.
   */
  get(protocolName: Protocol | string): ProtocolRunner {
    const runner = this.runners.get(protocolName)
    if (!runner) {
      const available = [...this.runners.keys()].join(', ')
      throw new Error(
        `No protocol runner registered for "${protocolName}". Available: ${available}`,
      )
    }
    return runner
  }

  /** List all registered protocol names. */
  list(): string[] {
    return [...this.runners.keys()]
  }
}
