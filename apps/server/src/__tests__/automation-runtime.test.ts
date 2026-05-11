import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FileAutomationStore,
  FileRunStore,
  type AutomationJobDefinition,
  type StepExecutor,
} from '@malayvuong/agent-orchestra-core'
import { ServerAutomationRuntime } from '../automation-runtime.js'

describe('ServerAutomationRuntime', () => {
  let tempDir: string | undefined

  const makeRuntime = async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ao-server-automation-'))
    const automationStore = new FileAutomationStore(tempDir)
    const runStore = new FileRunStore(tempDir)
    const executor: StepExecutor = {
      async execute(step) {
        return { summary: `ran ${step.name}` }
      },
    }
    const runtime = new ServerAutomationRuntime({
      storageDir: tempDir,
      workspaceDir: tempDir,
      automationStore,
      runStore,
      executors: new Map([['script', executor]]),
    })
    return { runtime, automationStore, runStore }
  }

  const makeJob = (overrides?: Partial<AutomationJobDefinition>): AutomationJobDefinition => ({
    id: 'scheduled-job',
    name: 'Scheduled Job',
    enabled: true,
    createdAt: Date.now(),
    schedule: 'every 1m',
    workflow: [
      {
        id: 'step-1',
        type: 'script',
        name: 'Step 1',
        config: { command: 'echo ok' },
      },
    ],
    ...overrides,
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('loads enabled scheduled jobs on start', async () => {
    const { runtime, automationStore } = await makeRuntime()
    await automationStore.save(makeJob())

    await runtime.start()

    expect(runtime.listScheduledJobs().map((job) => job.id)).toEqual(['scheduled-job'])

    runtime.shutdown()
  })

  it('runs automation jobs immediately and stores run records', async () => {
    const { runtime, runStore } = await makeRuntime()
    const result = await runtime.runJob(makeJob({ id: 'manual-job', schedule: undefined }))

    expect(result.error).toBeUndefined()
    const savedRun = await runStore.load(result.runRecord.runId)
    expect(savedRun?.status).toBe('completed')
    expect(savedRun?.toolCalls[0]?.summary).toBe('ran Step 1')

    runtime.shutdown()
  })

  it('removes deleted jobs from the scheduler and store', async () => {
    const { runtime, automationStore } = await makeRuntime()
    await runtime.saveAndSchedule(makeJob({ id: 'delete-me' }))

    await runtime.deleteJob('delete-me')

    expect(await automationStore.load('delete-me')).toBeUndefined()
    await expect(
      readFile(join(tempDir!, 'automation', 'delete-me.json'), 'utf-8'),
    ).rejects.toThrow()
    runtime.shutdown()
  })
})
