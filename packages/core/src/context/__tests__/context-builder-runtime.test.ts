import { describe, it, expect } from 'vitest'
import { ContextBuilder } from '../context-builder.js'
import type { SessionState, TaskState, RunRecord } from '../../types/runtime.js'
import type { AutomationJobDefinition } from '../../runner/types.js'

/**
 * Tests for the Phase 4 context builder expansion:
 * buildInteractiveContext, buildAutomationContext, buildVerificationContext
 */
describe('ContextBuilder — runtime context modes', () => {
  // Minimal stubs for required constructor deps (not used by new methods)
  const budgetManager = { fitToLimit: (ctx: unknown) => ctx }
  const tokenEstimator = { estimate: (s: string) => Math.ceil(s.length / 4) }
  const skillMatcher = { match: () => ({ matched: [], unmatched: [] }) }
  const skillInjector = { inject: () => ({ skillContext: '' }) }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const builder = new ContextBuilder(
    budgetManager as any,
    tokenEstimator as any,
    skillMatcher as any,
    skillInjector as any,
  )
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ─── buildInteractiveContext ─────────────────────────────────────

  describe('buildInteractiveContext', () => {
    const session: SessionState = {
      sessionId: 'sess-1',
      sessionType: 'interactive',
      owner: 'test-user',
      policyContext: 'default',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    }

    it('should build context with session info', () => {
      const ctx = builder.buildInteractiveContext(session)
      expect(ctx.sessionType).toBe('interactive')
      expect(ctx.policyFlags).toBe('default')
      expect(ctx.environmentFacts).toBeDefined()
      expect(ctx.environmentFacts.platform).toBeDefined()
    })

    it('should include task state when provided', () => {
      const task: TaskState = {
        taskId: 'task-1',
        sessionId: 'sess-1',
        origin: 'user',
        status: 'running',
        title: 'Fix bug',
        objective: 'Fix the login bug',
        executionRequired: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const ctx = builder.buildInteractiveContext(session, task)
      expect(ctx.taskState).toBeDefined()
      expect(ctx.taskState!.title).toBe('Fix bug')
      expect(ctx.taskState!.executionRequired).toBe(true)
    })

    it('should handle missing task', () => {
      const ctx = builder.buildInteractiveContext(session)
      expect(ctx.taskState).toBeUndefined()
    })
  })

  // ─── buildAutomationContext ──────────────────────────────────────

  describe('buildAutomationContext', () => {
    it('should build context from automation job', () => {
      const job: AutomationJobDefinition = {
        id: 'job-1',
        name: 'Daily backup',
        schedule: 'every 1d',
        workflow: [
          { id: 's1', type: 'script', name: 'Run backup', config: {} },
          { id: 's2', type: 'script', name: 'Verify', config: {}, dependsOn: ['s1'] },
        ],
        enabled: true,
        createdAt: Date.now(),
        lastRunStatus: 'ok',
      }
      const ctx = builder.buildAutomationContext(job)
      expect(ctx.jobId).toBe('job-1')
      expect(ctx.jobName).toBe('Daily backup')
      expect(ctx.schedule).toBe('every 1d')
      expect(ctx.lastRunStatus).toBe('ok')
      expect(ctx.workflow).toHaveLength(2)
      expect(ctx.workflow[0].name).toBe('Run backup')
    })
  })

  // ─── buildVerificationContext ────────────────────────────────────

  describe('buildVerificationContext', () => {
    it('should build context from task and run', () => {
      const task: TaskState = {
        taskId: 'task-1',
        origin: 'user',
        status: 'done',
        title: 'Deploy',
        objective: 'Deploy to production',
        executionRequired: true,
        lastEvidence: 'Deployed v2.1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const run: RunRecord = {
        runId: 'run-1',
        source: 'chat',
        startedAt: Date.now(),
        status: 'completed',
        toolCalls: [
          {
            id: 'tc1',
            name: 'bash',
            startedAt: Date.now(),
            status: 'ok',
            summary: 'Ran deploy script',
          },
          {
            id: 'tc2',
            name: 'read_file',
            startedAt: Date.now(),
            status: 'error',
            summary: 'File not found',
          },
        ],
        guardViolations: [],
      }
      const ctx = builder.buildVerificationContext(task, run)
      expect(ctx.taskId).toBe('task-1')
      expect(ctx.objective).toBe('Deploy to production')
      expect(ctx.lastEvidence).toBe('Deployed v2.1')
      expect(ctx.toolCalls).toHaveLength(2)
      expect(ctx.toolCalls[0].name).toBe('bash')
      expect(ctx.toolCalls[1].status).toBe('error')
    })
  })
})
