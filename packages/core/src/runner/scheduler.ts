import type { AutomationJobDefinition } from './types.js'

export type SchedulerConfig = {
  storageDir: string
  checkIntervalMs?: number
}

/**
 * Scheduler manages automation jobs and triggers them on simple interval schedules.
 *
 * Known limitation: setTimeout-based scheduling is subject to drift. Over long
 * periods the actual interval may diverge from the configured schedule. For
 * production use, a cron-backed scheduler would be more accurate.
 */
export class Scheduler {
  private readonly jobs = new Map<string, AutomationJobDefinition>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly runAutomation: (job: AutomationJobDefinition) => Promise<void>
  private readonly config: SchedulerConfig

  constructor(
    config: SchedulerConfig,
    runAutomation: (job: AutomationJobDefinition) => Promise<void>,
  ) {
    this.config = config
    this.runAutomation = runAutomation
  }

  /**
   * Register an automation job. If the job is enabled and has a schedule,
   * it will be scheduled for execution.
   */
  register(job: AutomationJobDefinition): void {
    this.jobs.set(job.id, job)

    if (job.enabled && job.schedule) {
      this.scheduleJob(job)
    }
  }

  /**
   * Unregister an automation job and clear its scheduled timer.
   */
  unregister(jobId: string): void {
    const timer = this.timers.get(jobId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(jobId)
    }
    this.jobs.delete(jobId)
  }

  /**
   * List all registered jobs.
   */
  listJobs(): AutomationJobDefinition[] {
    return Array.from(this.jobs.values())
  }

  /**
   * Shutdown the scheduler and clear all timers.
   */
  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  private scheduleJob(job: AutomationJobDefinition): void {
    const intervalMs = calculateNextRunMs(job.schedule ?? '')
    if (intervalMs <= 0) return

    const timer = setTimeout(async () => {
      this.timers.delete(job.id)

      try {
        await this.runAutomation(job)
        job.lastRunAt = Date.now()
        job.lastRunStatus = 'ok'
      } catch {
        job.lastRunAt = Date.now()
        job.lastRunStatus = 'failed'
      }

      // Re-schedule for the next interval
      const currentJob = this.jobs.get(job.id)
      if (currentJob?.enabled && currentJob.schedule) {
        this.scheduleJob(currentJob)
      }
    }, intervalMs)

    this.timers.set(job.id, timer)
  }
}

/**
 * Parse a simple interval string and return milliseconds.
 * Supports: "every 5m", "every 1h", "every 1d"
 * Returns 0 for unrecognized formats.
 */
export function calculateNextRunMs(schedule: string): number {
  const match = schedule.match(/^every\s+(\d+)\s*(m|h|d)$/)
  if (!match) return 0

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    default:
      return 0
  }
}
