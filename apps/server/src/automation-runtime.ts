import { execSync } from 'node:child_process'
import type {
  AutomationJobDefinition,
  FileAutomationStore,
  FileRunStore,
  RunnerResult,
  StepExecutor,
  WorkflowStep,
} from '@malayvuong/agent-orchestra-core'
import { AutomationRunner, Scheduler } from '@malayvuong/agent-orchestra-core'

export type ServerAutomationRuntimeOptions = {
  storageDir: string
  workspaceDir: string
  automationStore: FileAutomationStore
  runStore: FileRunStore
  executors?: Map<string, StepExecutor>
}

export function createScriptExecutor(workspaceDir: string): StepExecutor {
  return {
    async execute(step: WorkflowStep, options: { timeout?: number }) {
      const command = step.config.command as string
      if (!command) throw new Error('Script step requires config.command')

      const output = execSync(command, {
        cwd: workspaceDir,
        timeout: options.timeout ?? step.timeoutMs ?? 30_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      return { summary: output.trim().slice(0, 2000) }
    },
  }
}

export class ServerAutomationRuntime {
  private readonly executors: Map<string, StepExecutor>
  private readonly scheduler: Scheduler

  constructor(private readonly options: ServerAutomationRuntimeOptions) {
    this.executors =
      options.executors ?? new Map([['script', createScriptExecutor(options.workspaceDir)]])
    this.scheduler = new Scheduler(
      { storageDir: options.storageDir },
      async (job) => {
        const result = await this.runJob(job)
        if (result.error) throw new Error(result.error)
      },
      async (job) => {
        await this.options.automationStore.save(job)
      },
    )
  }

  async start(): Promise<void> {
    const jobs = await this.options.automationStore.list()
    for (const job of jobs) {
      if (job.enabled && job.schedule) {
        this.scheduler.register(job)
      }
    }
  }

  async saveAndSchedule(job: AutomationJobDefinition): Promise<void> {
    await this.options.automationStore.save(job)
    this.scheduler.unregister(job.id)
    if (job.enabled && job.schedule) {
      this.scheduler.register(job)
    }
  }

  async deleteJob(jobId: string): Promise<void> {
    this.scheduler.unregister(jobId)
    await this.options.automationStore.delete(jobId)
  }

  listScheduledJobs(): AutomationJobDefinition[] {
    return this.scheduler.listJobs()
  }

  async runJob(job: AutomationJobDefinition): Promise<RunnerResult> {
    const runner = new AutomationRunner(this.options.runStore, this.executors)
    const result = await runner.execute(
      {
        source: 'system',
        sessionId: `automation-${job.id}`,
        actorId: 'server',
        trustedMeta: { automationJob: job },
        requestedMode: 'automation',
      },
      {
        sessionId: `automation-${job.id}`,
        sessionType: 'cron',
        owner: 'server',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    )

    job.lastRunAt = Date.now()
    job.lastRunStatus = result.error ? 'failed' : 'ok'
    await this.options.automationStore.save(job)

    return result
  }

  shutdown(): void {
    this.scheduler.shutdown()
  }
}
