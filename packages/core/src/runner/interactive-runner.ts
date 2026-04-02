import { randomUUID } from 'node:crypto'
import type { RunMode, RunRequest, SessionState } from '../types/runtime.js'
import type { RunStore } from '../storage/runtime-store.js'
import type { TaskStore } from '../storage/runtime-store.js'
import type { Runner, RunnerResult } from './types.js'
import { TaskClassifier } from '../guard/task-classifier.js'
import { collectEvidence } from '../guard/evidence-collector.js'

/**
 * InteractiveRunner handles user-facing interactive requests.
 *
 * It wraps two execution paths:
 * - Debate flow: delegates to an existing Orchestrator (code review)
 * - Direct flow: single-turn model call with tool access (Phase 4 MVP)
 *
 * The direct flow is intentionally single-turn for MVP.
 * Multi-turn agentic loops are deferred to Phase 5+.
 */
export class InteractiveRunner implements Runner {
  readonly mode: RunMode = 'interactive'
  private taskClassifier = new TaskClassifier()

  constructor(
    private readonly runStore: RunStore,
    private readonly taskStore: TaskStore,
    private readonly executeModel?: (request: RunRequest) => Promise<{
      text: string
      toolCalls?: Array<{
        id: string
        name: string
        result?: string
        durationMs?: number
        status?: 'ok' | 'error' | 'timeout'
      }>
    }>,
  ) {}

  async execute(request: RunRequest, session: SessionState): Promise<RunnerResult> {
    // Create RunRecord
    const run = await this.runStore.create({
      runId: randomUUID(),
      sessionId: session.sessionId,
      source: request.source,
      startedAt: Date.now(),
      status: 'running',
      model: session.modelConfig?.model,
    })

    // Classify the task
    const classification = this.taskClassifier.classify(request.userMessage ?? '')

    // Create TaskState
    const task = await this.taskStore.create({
      sessionId: session.sessionId,
      runId: run.runId,
      origin: 'user',
      status: 'running',
      title: (request.userMessage ?? 'Interactive task').slice(0, 80),
      objective: request.userMessage ?? '',
      executionRequired: classification.executionRequired,
    })

    // Update run with taskId
    await this.runStore.update(run.runId, { taskId: task.taskId })

    // If no model executor is provided, return a skeleton result
    // (this allows the runner to be used in test/wiring contexts)
    if (!this.executeModel) {
      const updated = await this.runStore.update(run.runId, {
        status: 'completed',
        endedAt: Date.now(),
        finalReply: '(no model executor configured)',
      })

      await this.taskStore.update(task.taskId, { status: 'done' })

      return {
        runRecord: updated,
        output: '(no model executor configured)',
      }
    }

    try {
      // Execute model call
      const modelResult = await this.executeModel(request)

      // Log tool calls to RunRecord
      for (const tc of modelResult.toolCalls ?? []) {
        await this.runStore.appendToolCall(run.runId, {
          id: tc.id || randomUUID(),
          name: tc.name,
          startedAt: Date.now(),
          endedAt: Date.now(),
          status: tc.status ?? 'ok',
          summary: tc.result?.slice(0, 200),
          durationMs: tc.durationMs,
        })
      }

      // Update task with evidence
      const updatedRun = await this.runStore.load(run.runId)
      const evidence = collectEvidence(updatedRun?.toolCalls ?? [])
      if (evidence.length > 0) {
        await this.taskStore.update(task.taskId, {
          lastActionAt: Date.now(),
          lastEvidence: evidence[0].summary,
          status: 'done',
        })
      } else {
        await this.taskStore.update(task.taskId, { status: 'done' })
      }

      // Complete run
      const completed = await this.runStore.update(run.runId, {
        status: 'completed',
        endedAt: Date.now(),
        finalReply: modelResult.text,
      })

      return {
        runRecord: completed,
        output: modelResult.text,
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)

      await this.taskStore.update(task.taskId, {
        status: 'failed',
        blocker: reason,
      })

      const failed = await this.runStore.update(run.runId, {
        status: 'failed',
        endedAt: Date.now(),
        failureReason: reason,
      })

      return {
        runRecord: failed,
        error: reason,
      }
    }
  }

  async cancel(runId: string): Promise<void> {
    await this.runStore.update(runId, {
      status: 'cancelled',
      endedAt: Date.now(),
    })
  }
}
