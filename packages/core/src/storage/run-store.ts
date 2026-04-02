import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunRecord, ToolCallRecord, GuardViolation } from '../types/runtime.js'
import type { RunStore } from './runtime-store.js'

/**
 * File-based RunStore implementation.
 * Persists runs as JSON files under: {baseDir}/runs/{runId}.json
 */
export class FileRunStore implements RunStore {
  private readonly runsDir: string

  constructor(baseDir: string) {
    this.runsDir = join(baseDir, 'runs')
  }

  async create(partial: Omit<RunRecord, 'toolCalls' | 'guardViolations'>): Promise<RunRecord> {
    const run: RunRecord = {
      ...partial,
      runId: partial.runId || randomUUID(),
      toolCalls: [],
      guardViolations: [],
    }
    await this.save(run)
    return run
  }

  async load(runId: string): Promise<RunRecord | undefined> {
    try {
      const raw = await readFile(this.filePath(runId), 'utf-8')
      return JSON.parse(raw) as RunRecord
    } catch {
      return undefined
    }
  }

  async update(runId: string, patch: Partial<RunRecord>): Promise<RunRecord> {
    const run = await this.load(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }
    const updated: RunRecord = { ...run, ...patch, runId: run.runId }
    await this.save(updated)
    return updated
  }

  async listBySession(sessionId: string): Promise<RunRecord[]> {
    const all = await this.listAll()
    return all.filter((r) => r.sessionId === sessionId)
  }

  async listByTask(taskId: string): Promise<RunRecord[]> {
    const all = await this.listAll()
    return all.filter((r) => r.taskId === taskId)
  }

  async appendToolCall(runId: string, toolCall: ToolCallRecord): Promise<void> {
    const run = await this.load(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }
    run.toolCalls.push(toolCall)
    await this.save(run)
  }

  async appendGuardViolation(runId: string, violation: GuardViolation): Promise<void> {
    const run = await this.load(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }
    run.guardViolations.push(violation)
    await this.save(run)
  }

  private async save(run: RunRecord): Promise<void> {
    await mkdir(this.runsDir, { recursive: true })
    await writeFile(this.filePath(run.runId), JSON.stringify(run, null, 2), 'utf-8')
  }

  private filePath(runId: string): string {
    return join(this.runsDir, `${runId}.json`)
  }

  private async listAll(): Promise<RunRecord[]> {
    try {
      const entries = await readdir(this.runsDir)
      const runs: RunRecord[] = []
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          try {
            const raw = await readFile(join(this.runsDir, entry), 'utf-8')
            runs.push(JSON.parse(raw) as RunRecord)
          } catch {
            // skip corrupt files
          }
        }
      }
      return runs
    } catch {
      return []
    }
  }
}
