import { randomUUID } from 'node:crypto'
import type { ToolCallRecord } from '../types/runtime.js'
import type { RunStore } from '../storage/runtime-store.js'
import type {
  Runner,
  RunnerResult,
  AutomationJobDefinition,
  WorkflowStep,
  StepExecutor,
} from './types.js'
import type { RunMode, RunRequest, SessionState } from '../types/runtime.js'

/**
 * AutomationRunner executes automation workflows as isolated runs.
 *
 * Each workflow step is logged as a ToolCallRecord. Steps are executed
 * in topological order based on their dependsOn declarations, with
 * optional retry support per step.
 */
export class AutomationRunner implements Runner {
  readonly mode: RunMode = 'automation'

  constructor(
    private readonly runStore: RunStore,
    private readonly executors: Map<string, StepExecutor>,
  ) {}

  async execute(request: RunRequest, session: SessionState): Promise<RunnerResult> {
    const run = await this.runStore.create({
      runId: randomUUID(),
      sessionId: session.sessionId,
      source: request.source,
      startedAt: Date.now(),
      status: 'running',
    })

    const job = request.trustedMeta['automationJob'] as AutomationJobDefinition | undefined
    if (!job) {
      const updated = await this.runStore.update(run.runId, {
        status: 'failed',
        endedAt: Date.now(),
        failureReason: 'No automation job definition in trustedMeta',
      })
      return { runRecord: updated, error: updated.failureReason }
    }

    let orderedSteps: WorkflowStep[]
    try {
      orderedSteps = resolveOrder(job.workflow)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const updated = await this.runStore.update(run.runId, {
        status: 'failed',
        endedAt: Date.now(),
        failureReason: message,
      })
      return { runRecord: updated, error: message }
    }

    const artifacts: Array<{ name: string; content: string }> = []

    for (const step of orderedSteps) {
      const executor = this.executors.get(step.type)
      if (!executor) {
        const reason = `No executor registered for step type: ${step.type}`
        const updated = await this.runStore.update(run.runId, {
          status: 'failed',
          endedAt: Date.now(),
          failureReason: reason,
        })
        return { runRecord: updated, error: reason }
      }

      // Check if run was cancelled before executing this step
      const currentRun = await this.runStore.load(run.runId)
      if (currentRun?.status === 'cancelled') {
        return { runRecord: currentRun, error: 'Run was cancelled' }
      }

      const maxAttempts = (step.retryCount ?? 0) + 1
      let lastError: string | undefined
      let succeeded = false

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const toolCall: ToolCallRecord = {
          id: randomUUID(),
          name: step.name,
          startedAt: Date.now(),
          status: 'ok',
        }

        try {
          const result = await executor.execute(step, { timeout: step.timeoutMs })
          toolCall.endedAt = Date.now()
          toolCall.durationMs = toolCall.endedAt - toolCall.startedAt
          toolCall.summary = result.summary
          toolCall.status = 'ok'

          await this.runStore.appendToolCall(run.runId, toolCall)

          if (result.artifact) {
            artifacts.push(result.artifact)
          }

          succeeded = true
          break
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          toolCall.endedAt = Date.now()
          toolCall.durationMs = toolCall.endedAt - toolCall.startedAt
          toolCall.status = 'error'
          toolCall.summary = `Attempt ${attempt}/${maxAttempts} failed: ${lastError}`

          await this.runStore.appendToolCall(run.runId, toolCall)
        }
      }

      if (!succeeded) {
        // Fail-fast: stop workflow after exhausting retries for a step
        const reason = `Step "${step.name}" failed after ${maxAttempts} attempt(s): ${lastError}`
        const updated = await this.runStore.update(run.runId, {
          status: 'failed',
          endedAt: Date.now(),
          failureReason: reason,
        })
        return { runRecord: updated, error: reason, artifacts }
      }
    }

    const completed = await this.runStore.update(run.runId, {
      status: 'completed',
      endedAt: Date.now(),
    })

    return { runRecord: completed, artifacts }
  }

  async cancel(runId: string): Promise<void> {
    await this.runStore.update(runId, {
      status: 'cancelled',
      endedAt: Date.now(),
    })
  }
}

/**
 * Topological sort of workflow steps based on dependsOn declarations.
 * Throws if a circular dependency is detected.
 */
export function resolveOrder(steps: WorkflowStep[]): WorkflowStep[] {
  const stepMap = new Map<string, WorkflowStep>()
  for (const step of steps) {
    stepMap.set(step.id, step)
  }

  const visited = new Set<string>()
  const visiting = new Set<string>() // cycle detection
  const ordered: WorkflowStep[] = []

  function visit(stepId: string): void {
    if (visited.has(stepId)) return
    if (visiting.has(stepId)) {
      throw new Error(`Circular dependency detected involving step: ${stepId}`)
    }

    const step = stepMap.get(stepId)
    if (!step) {
      throw new Error(`Unknown step dependency: ${stepId}`)
    }

    visiting.add(stepId)

    for (const depId of step.dependsOn ?? []) {
      visit(depId)
    }

    visiting.delete(stepId)
    visited.add(stepId)
    ordered.push(step)
  }

  for (const step of steps) {
    visit(step.id)
  }

  return ordered
}
