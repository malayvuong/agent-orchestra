import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AutomationRunner, resolveOrder } from '../automation-runner.js'
import { FileRunStore } from '../../storage/run-store.js'
import type { RunRequest, SessionState } from '../../types/runtime.js'
import type { WorkflowStep, StepExecutor, AutomationJobDefinition } from '../types.js'

describe('AutomationRunner', () => {
  let baseDir: string
  let runStore: FileRunStore
  let runner: AutomationRunner

  const makeSession = (): SessionState => ({
    sessionId: 'sess-1',
    sessionType: 'cron',
    owner: 'system',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  })

  const makeRequest = (job: AutomationJobDefinition): RunRequest => ({
    source: 'cron',
    sessionId: 'sess-1',
    actorId: 'system',
    trustedMeta: { automationJob: job },
    requestedMode: 'automation',
  })

  const makeJob = (workflow: WorkflowStep[]): AutomationJobDefinition => ({
    id: 'job-1',
    name: 'Test Job',
    workflow,
    enabled: true,
    createdAt: Date.now(),
  })

  const okExecutor: StepExecutor = {
    execute: async (step) => ({ summary: `Executed ${step.name}` }),
  }

  const failExecutor: StepExecutor = {
    execute: async () => {
      throw new Error('Step execution failed')
    },
  }

  const artifactExecutor: StepExecutor = {
    execute: async (step) => ({
      summary: `Produced artifact`,
      artifact: { name: `${step.name}.txt`, content: 'data' },
    }),
  }

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-automation-'))
    runStore = new FileRunStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should execute a workflow with mock step executors', async () => {
    const executors = new Map<string, StepExecutor>([['tool_call', okExecutor]])
    runner = new AutomationRunner(runStore, executors)

    const workflow: WorkflowStep[] = [
      { id: 's1', type: 'tool_call', name: 'step-1', config: {} },
      { id: 's2', type: 'tool_call', name: 'step-2', config: {} },
    ]

    const result = await runner.execute(makeRequest(makeJob(workflow)), makeSession())

    expect(result.runRecord.status).toBe('completed')
    expect(result.error).toBeUndefined()

    const loaded = await runStore.load(result.runRecord.runId)
    expect(loaded!.toolCalls).toHaveLength(2)
    expect(loaded!.toolCalls[0].summary).toBe('Executed step-1')
    expect(loaded!.toolCalls[1].summary).toBe('Executed step-2')
  })

  it('should collect artifacts from steps', async () => {
    const executors = new Map<string, StepExecutor>([['tool_call', artifactExecutor]])
    runner = new AutomationRunner(runStore, executors)

    const workflow: WorkflowStep[] = [{ id: 's1', type: 'tool_call', name: 'report', config: {} }]

    const result = await runner.execute(makeRequest(makeJob(workflow)), makeSession())

    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts![0].name).toBe('report.txt')
    expect(result.artifacts![0].content).toBe('data')
  })

  it('should mark run as failed when a step fails', async () => {
    const executors = new Map<string, StepExecutor>([['tool_call', failExecutor]])
    runner = new AutomationRunner(runStore, executors)

    const workflow: WorkflowStep[] = [
      { id: 's1', type: 'tool_call', name: 'broken-step', config: {} },
    ]

    const result = await runner.execute(makeRequest(makeJob(workflow)), makeSession())

    expect(result.runRecord.status).toBe('failed')
    expect(result.error).toContain('broken-step')
    expect(result.error).toContain('Step execution failed')
  })

  it('should retry then fail-fast after exhausting retries', async () => {
    let callCount = 0
    const countingFailExecutor: StepExecutor = {
      execute: async () => {
        callCount++
        throw new Error('Transient failure')
      },
    }

    const executors = new Map<string, StepExecutor>([['tool_call', countingFailExecutor]])
    runner = new AutomationRunner(runStore, executors)

    const workflow: WorkflowStep[] = [
      { id: 's1', type: 'tool_call', name: 'retry-step', config: {}, retryCount: 2 },
      { id: 's2', type: 'tool_call', name: 'never-reached', config: {} },
    ]

    const result = await runner.execute(makeRequest(makeJob(workflow)), makeSession())

    expect(result.runRecord.status).toBe('failed')
    expect(callCount).toBe(3) // 1 initial + 2 retries
    expect(result.error).toContain('3 attempt(s)')

    // Verify the second step was never reached
    const loaded = await runStore.load(result.runRecord.runId)
    const stepNames = loaded!.toolCalls.map((tc) => tc.name)
    expect(stepNames.every((n) => n === 'retry-step')).toBe(true)
  })

  it('should retry and succeed on later attempt', async () => {
    let callCount = 0
    const flakyExecutor: StepExecutor = {
      execute: async (_step) => {
        callCount++
        if (callCount < 3) throw new Error('Transient')
        return { summary: 'OK after retries' }
      },
    }

    const executors = new Map<string, StepExecutor>([['tool_call', flakyExecutor]])
    runner = new AutomationRunner(runStore, executors)

    const workflow: WorkflowStep[] = [
      { id: 's1', type: 'tool_call', name: 'flaky-step', config: {}, retryCount: 3 },
    ]

    const result = await runner.execute(makeRequest(makeJob(workflow)), makeSession())

    expect(result.runRecord.status).toBe('completed')
    expect(callCount).toBe(3)
  })

  it('should fail when no executor is registered for a step type', async () => {
    const executors = new Map<string, StepExecutor>()
    runner = new AutomationRunner(runStore, executors)

    const workflow: WorkflowStep[] = [{ id: 's1', type: 'script', name: 'unhandled', config: {} }]

    const result = await runner.execute(makeRequest(makeJob(workflow)), makeSession())

    expect(result.runRecord.status).toBe('failed')
    expect(result.error).toContain('No executor registered for step type: script')
  })

  it('should fail when no automation job is in trustedMeta', async () => {
    const executors = new Map<string, StepExecutor>()
    runner = new AutomationRunner(runStore, executors)

    const request: RunRequest = {
      source: 'cron',
      sessionId: 'sess-1',
      actorId: 'system',
      trustedMeta: {},
      requestedMode: 'automation',
    }

    const result = await runner.execute(request, makeSession())

    expect(result.runRecord.status).toBe('failed')
    expect(result.error).toContain('No automation job definition')
  })

  it('should cancel a run', async () => {
    const executors = new Map<string, StepExecutor>([['tool_call', okExecutor]])
    runner = new AutomationRunner(runStore, executors)

    // Create a run first
    const workflow: WorkflowStep[] = [{ id: 's1', type: 'tool_call', name: 'step-1', config: {} }]

    const result = await runner.execute(makeRequest(makeJob(workflow)), makeSession())
    const runId = result.runRecord.runId

    await runner.cancel(runId)

    const loaded = await runStore.load(runId)
    expect(loaded!.status).toBe('cancelled')
    expect(loaded!.endedAt).toBeDefined()
  })
})

describe('resolveOrder', () => {
  it('should return steps in dependency order', () => {
    const steps: WorkflowStep[] = [
      { id: 'c', type: 'tool_call', name: 'C', config: {}, dependsOn: ['a', 'b'] },
      { id: 'a', type: 'tool_call', name: 'A', config: {} },
      { id: 'b', type: 'tool_call', name: 'B', config: {}, dependsOn: ['a'] },
    ]

    const ordered = resolveOrder(steps)
    const ids = ordered.map((s) => s.id)

    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'))
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'))
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'))
  })

  it('should handle steps with no dependencies', () => {
    const steps: WorkflowStep[] = [
      { id: 'a', type: 'tool_call', name: 'A', config: {} },
      { id: 'b', type: 'tool_call', name: 'B', config: {} },
    ]

    const ordered = resolveOrder(steps)
    expect(ordered).toHaveLength(2)
  })

  it('should detect circular dependencies', () => {
    const steps: WorkflowStep[] = [
      { id: 'a', type: 'tool_call', name: 'A', config: {}, dependsOn: ['b'] },
      { id: 'b', type: 'tool_call', name: 'B', config: {}, dependsOn: ['a'] },
    ]

    expect(() => resolveOrder(steps)).toThrow('Circular dependency')
  })

  it('should detect self-referencing dependency', () => {
    const steps: WorkflowStep[] = [
      { id: 'a', type: 'tool_call', name: 'A', config: {}, dependsOn: ['a'] },
    ]

    expect(() => resolveOrder(steps)).toThrow('Circular dependency')
  })

  it('should throw for unknown dependency', () => {
    const steps: WorkflowStep[] = [
      { id: 'a', type: 'tool_call', name: 'A', config: {}, dependsOn: ['missing'] },
    ]

    expect(() => resolveOrder(steps)).toThrow('Unknown step dependency: missing')
  })
})
