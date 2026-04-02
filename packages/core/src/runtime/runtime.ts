/**
 * Runtime (Phase 4).
 *
 * Central request router that sits above all runners. Responsibilities:
 * - Session management (get or create)
 * - Transcript logging (inbound + outbound)
 * - Runner dispatch by RunMode
 * - Execution guard enforcement for interactive mode
 * - Error resilience: store failures are caught and logged, never crash the runtime
 */

import type { RunRequest, RunMode, SessionState } from '../types/runtime.js'
import type { Runner, RunnerResult } from '../runner/types.js'
import type {
  SessionStore,
  RunStore,
  TaskStore,
  TranscriptStore,
} from '../storage/runtime-store.js'
import type { ExecutionGuard } from '../guard/execution-guard.js'

export class Runtime {
  private runners: Map<RunMode, Runner> = new Map()

  constructor(
    private sessionStore: SessionStore,
    private runStore: RunStore,
    private taskStore: TaskStore,
    private transcriptStore: TranscriptStore,
    private executionGuard: ExecutionGuard,
  ) {}

  registerRunner(runner: Runner): void {
    this.runners.set(runner.mode, runner)
  }

  async handleRequest(request: RunRequest): Promise<RunnerResult> {
    // 1. Get or create session
    let session: SessionState | undefined
    try {
      session = await this.sessionStore.load(request.sessionId)
      if (!session) {
        session = await this.sessionStore.create({
          sessionId: request.sessionId,
          sessionType: this.mapSourceToSessionType(request.source),
          owner: request.actorId,
          channel: request.source,
        })
      }
    } catch (err) {
      console.warn('[Runtime] SessionStore error, using fallback session:', err)
      session = {
        sessionId: request.sessionId,
        sessionType: this.mapSourceToSessionType(request.source),
        owner: request.actorId,
        channel: request.source,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      }
    }

    // 2. Log inbound to transcript
    if (request.userMessage) {
      try {
        await this.transcriptStore.append(session.sessionId, {
          role: 'user',
          timestamp: Date.now(),
          trustLevel: 'user_input',
          content: request.userMessage,
        })
      } catch (err) {
        console.warn('[Runtime] TranscriptStore.append error (userMessage):', err)
      }
    }
    if (request.systemEvent) {
      try {
        await this.transcriptStore.append(session.sessionId, {
          role: 'system',
          timestamp: Date.now(),
          trustLevel: request.source === 'cron' ? 'automation' : 'system',
          content: request.systemEvent,
        })
      } catch (err) {
        console.warn('[Runtime] TranscriptStore.append error (systemEvent):', err)
      }
    }

    // 3. Route to appropriate runner
    const runner = this.runners.get(request.requestedMode)
    if (!runner) {
      throw new Error(`No runner registered for mode: ${request.requestedMode}`)
    }

    // 4. Execute
    const result = await runner.execute(request, session)

    // 5. Apply execution guard (for interactive mode only)
    if (request.requestedMode === 'interactive' && result.output) {
      try {
        const task = result.runRecord.taskId
          ? await this.taskStore.load(result.runRecord.taskId)
          : undefined

        const guardResult = this.executionGuard.validate({
          text: result.output,
          toolCalls: result.runRecord.toolCalls,
          task: task ?? undefined,
        })

        if (!guardResult.allowed) {
          // Log violations to run store
          for (const violation of guardResult.violations) {
            try {
              await this.runStore.appendGuardViolation(result.runRecord.runId, violation)
            } catch (err) {
              console.warn('[Runtime] RunStore.appendGuardViolation error:', err)
            }
          }

          // Log to transcript
          try {
            await this.transcriptStore.append(session.sessionId, {
              role: 'system',
              timestamp: Date.now(),
              trustLevel: 'system',
              content: {
                type: 'guard_violation',
                violations: guardResult.violations,
                suggestedAction: guardResult.suggestedAction,
              },
            })
          } catch (err) {
            console.warn('[Runtime] TranscriptStore.append error (guard violation):', err)
          }

          // Mark result as blocked
          try {
            result.runRecord = await this.runStore.update(result.runRecord.runId, {
              status: 'blocked',
              failureReason: `Execution guard: ${guardResult.violations.map((v) => v.type).join(', ')}`,
            })
          } catch (err) {
            console.warn('[Runtime] RunStore.update error (blocked):', err)
          }
        }
      } catch (err) {
        console.warn('[Runtime] Guard evaluation error:', err)
      }
    }

    // 6. Log output to transcript
    if (result.output) {
      try {
        await this.transcriptStore.append(session.sessionId, {
          role: 'assistant',
          timestamp: Date.now(),
          trustLevel: 'system',
          content: result.output,
        })
      } catch (err) {
        console.warn('[Runtime] TranscriptStore.append error (output):', err)
      }
    }

    // 7. Touch session
    try {
      await this.sessionStore.touch(session.sessionId)
    } catch (err) {
      console.warn('[Runtime] SessionStore.touch error:', err)
    }

    return result
  }

  private mapSourceToSessionType(source: RunRequest['source']): SessionState['sessionType'] {
    switch (source) {
      case 'cron':
        return 'cron'
      case 'system':
      case 'subagent':
        return 'subagent'
      default:
        return 'interactive'
    }
  }
}
