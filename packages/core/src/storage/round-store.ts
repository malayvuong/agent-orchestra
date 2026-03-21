import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Round } from '../types/protocol.js'
import type { RoundStore } from './types.js'

/**
 * File-based RoundStore implementation.
 * Persists rounds as JSON files under: {baseDir}/jobs/{jobId}/rounds/round-{index}.json
 */
export class FileRoundStore implements RoundStore {
  private readonly jobsDir: string

  constructor(baseDir: string) {
    this.jobsDir = join(baseDir, 'jobs')
  }

  /** Save a round to disk. Creates the rounds directory if needed. */
  async save(round: Round): Promise<void> {
    const dir = this.roundsDir(round.jobId)
    await mkdir(dir, { recursive: true })
    const filePath = this.roundFilePath(round.jobId, round.index)
    await writeFile(filePath, JSON.stringify(round, null, 2), 'utf-8')
  }

  /** Load a specific round by job ID and round index. Returns undefined if not found. */
  async load(jobId: string, roundIndex: number): Promise<Round | undefined> {
    const filePath = this.roundFilePath(jobId, roundIndex)
    try {
      const raw = await readFile(filePath, 'utf-8')
      return JSON.parse(raw) as Round
    } catch {
      return undefined
    }
  }

  /** List all rounds for a given job, sorted by index. */
  async listByJob(jobId: string): Promise<Round[]> {
    const dir = this.roundsDir(jobId)
    try {
      const entries = await readdir(dir)
      const rounds: Round[] = []

      for (const entry of entries) {
        if (entry.startsWith('round-') && entry.endsWith('.json')) {
          const filePath = join(dir, entry)
          const raw = await readFile(filePath, 'utf-8')
          rounds.push(JSON.parse(raw) as Round)
        }
      }

      return rounds.sort((a, b) => a.index - b.index)
    } catch {
      // Rounds directory does not exist yet
      return []
    }
  }

  /** Get the rounds directory path for a job. */
  private roundsDir(jobId: string): string {
    return join(this.jobsDir, jobId, 'rounds')
  }

  /** Get the file path for a specific round. */
  private roundFilePath(jobId: string, roundIndex: number): string {
    return join(this.roundsDir(jobId), `round-${roundIndex}.json`)
  }
}
