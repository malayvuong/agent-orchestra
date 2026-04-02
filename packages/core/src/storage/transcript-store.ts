import { randomUUID } from 'node:crypto'
import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TranscriptEntry } from '../types/runtime.js'
import type { TranscriptStore } from './runtime-store.js'

/**
 * File-based TranscriptStore implementation.
 * Persists transcript entries as append-only JSONL files under:
 * {baseDir}/sessions/{sessionId}/transcript.jsonl
 */
export class FileTranscriptStore implements TranscriptStore {
  private readonly sessionsDir: string

  constructor(baseDir: string) {
    this.sessionsDir = join(baseDir, 'sessions')
  }

  async append(sessionId: string, partial: Omit<TranscriptEntry, 'id'>): Promise<TranscriptEntry> {
    const entry: TranscriptEntry = {
      ...partial,
      id: randomUUID(),
    }
    const dir = this.sessionDir(sessionId)
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, 'transcript.jsonl')
    await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8')
    return entry
  }

  async loadBySession(
    sessionId: string,
    options?: { limit?: number; afterTimestamp?: number },
  ): Promise<TranscriptEntry[]> {
    let entries = await this.readEntries(sessionId)

    if (options?.afterTimestamp !== undefined) {
      entries = entries.filter((e) => e.timestamp > options.afterTimestamp!)
    }

    if (options?.limit !== undefined) {
      entries = entries.slice(0, options.limit)
    }

    return entries
  }

  async loadByRun(runId: string): Promise<TranscriptEntry[]> {
    // loadByRun requires scanning all sessions since we don't index by runId.
    // For the file-based implementation, the caller must provide the sessionId
    // context externally. However, the interface doesn't include sessionId,
    // so we scan all session directories.
    try {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(this.sessionsDir, { withFileTypes: true })
      const results: TranscriptEntry[] = []

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionEntries = await this.readEntries(entry.name)
          for (const te of sessionEntries) {
            if (te.runId === runId) {
              results.push(te)
            }
          }
        }
      }

      return results
    } catch {
      return []
    }
  }

  private sessionDir(sessionId: string): string {
    return join(this.sessionsDir, sessionId)
  }

  private async readEntries(sessionId: string): Promise<TranscriptEntry[]> {
    const filePath = join(this.sessionDir(sessionId), 'transcript.jsonl')
    try {
      const raw = await readFile(filePath, 'utf-8')
      const lines = raw.trim().split('\n')
      const entries: TranscriptEntry[] = []
      for (const line of lines) {
        if (line.trim()) {
          try {
            entries.push(JSON.parse(line) as TranscriptEntry)
          } catch {
            // skip corrupt lines
          }
        }
      }
      return entries
    } catch {
      return []
    }
  }
}
