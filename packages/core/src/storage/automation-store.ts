import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutomationJobDefinition } from '../runner/types.js'

/**
 * File-based automation job store.
 * Persists jobs as JSON files under: {baseDir}/automation/{jobId}.json
 */
export class FileAutomationStore {
  private readonly automationDir: string

  constructor(baseDir: string) {
    this.automationDir = join(baseDir, 'automation')
  }

  /** Save (create or overwrite) an automation job definition. */
  async save(job: AutomationJobDefinition): Promise<void> {
    await mkdir(this.automationDir, { recursive: true })
    await writeFile(this.filePath(job.id), JSON.stringify(job, null, 2), 'utf-8')
  }

  /** Load an automation job by ID. Returns undefined if not found. */
  async load(jobId: string): Promise<AutomationJobDefinition | undefined> {
    try {
      const raw = await readFile(this.filePath(jobId), 'utf-8')
      return JSON.parse(raw) as AutomationJobDefinition
    } catch {
      return undefined
    }
  }

  /** List all automation jobs. */
  async list(): Promise<AutomationJobDefinition[]> {
    try {
      const entries = await readdir(this.automationDir)
      const jobs: AutomationJobDefinition[] = []
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          try {
            const raw = await readFile(join(this.automationDir, entry), 'utf-8')
            jobs.push(JSON.parse(raw) as AutomationJobDefinition)
          } catch {
            // skip corrupt files
          }
        }
      }
      return jobs
    } catch {
      return []
    }
  }

  /** Delete an automation job by ID. */
  async delete(jobId: string): Promise<void> {
    try {
      await unlink(this.filePath(jobId))
    } catch {
      // ignore if not found
    }
  }

  private filePath(jobId: string): string {
    return join(this.automationDir, `${jobId}.json`)
  }
}
