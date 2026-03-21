import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * NDJSON event logger.
 * Appends one JSON line per event to: {baseDir}/jobs/{jobId}/events.log
 */
export class EventLogger {
  private readonly jobsDir: string

  constructor(baseDir: string) {
    this.jobsDir = join(baseDir, 'jobs')
  }

  /**
   * Append an event as a single NDJSON line to the job's event log.
   * Adds a timestamp field if not already present.
   */
  async log(jobId: string, event: Record<string, unknown>): Promise<void> {
    const dir = join(this.jobsDir, jobId)
    await mkdir(dir, { recursive: true })

    const entry = {
      ...event,
      timestamp: event['timestamp'] ?? new Date().toISOString(),
    }

    const line = JSON.stringify(entry) + '\n'
    const filePath = join(dir, 'events.log')
    await appendFile(filePath, line, 'utf-8')
  }
}
