import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionState } from '../types/runtime.js'
import type { SessionStore } from './runtime-store.js'

/**
 * File-based SessionStore implementation.
 * Persists sessions as JSON files under: {baseDir}/sessions/{sessionId}.json
 */
export class FileSessionStore implements SessionStore {
  private readonly sessionsDir: string

  constructor(baseDir: string) {
    this.sessionsDir = join(baseDir, 'sessions')
  }

  async create(partial: Omit<SessionState, 'createdAt' | 'lastActivityAt'>): Promise<SessionState> {
    const now = Date.now()
    const session: SessionState = {
      ...partial,
      createdAt: now,
      lastActivityAt: now,
    }
    await this.save(session)
    return session
  }

  async load(sessionId: string): Promise<SessionState | undefined> {
    try {
      const raw = await readFile(this.filePath(sessionId), 'utf-8')
      return JSON.parse(raw) as SessionState
    } catch {
      return undefined
    }
  }

  async update(sessionId: string, patch: Partial<SessionState>): Promise<SessionState> {
    const session = await this.load(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const updated: SessionState = {
      ...session,
      ...patch,
      sessionId: session.sessionId,
      createdAt: session.createdAt,
    }
    await this.save(updated)
    return updated
  }

  async list(): Promise<SessionState[]> {
    try {
      const entries = await readdir(this.sessionsDir)
      const sessions: SessionState[] = []
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          try {
            const raw = await readFile(join(this.sessionsDir, entry), 'utf-8')
            sessions.push(JSON.parse(raw) as SessionState)
          } catch {
            // skip corrupt files
          }
        }
      }
      return sessions
    } catch {
      return []
    }
  }

  async touch(sessionId: string): Promise<void> {
    const session = await this.load(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    session.lastActivityAt = Date.now()
    await this.save(session)
  }

  private async save(session: SessionState): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true })
    await writeFile(this.filePath(session.sessionId), JSON.stringify(session, null, 2), 'utf-8')
  }

  private filePath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`)
  }
}
