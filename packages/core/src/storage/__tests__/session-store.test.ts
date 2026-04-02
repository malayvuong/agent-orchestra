import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileSessionStore } from '../session-store.js'
import type { SessionState } from '../../types/runtime.js'

describe('FileSessionStore', () => {
  let baseDir: string
  let store: FileSessionStore

  const makeSession = (
    overrides?: Partial<Omit<SessionState, 'createdAt' | 'lastActivityAt'>>,
  ): Omit<SessionState, 'createdAt' | 'lastActivityAt'> => ({
    sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`,
    sessionType: 'interactive',
    owner: 'test-user',
    ...overrides,
  })

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-sessionstore-'))
    store = new FileSessionStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should create a session with auto timestamps', async () => {
    const before = Date.now()
    const session = await store.create(makeSession({ sessionId: 'sess-1' }))
    const after = Date.now()

    expect(session.sessionId).toBe('sess-1')
    expect(session.sessionType).toBe('interactive')
    expect(session.owner).toBe('test-user')
    expect(session.createdAt).toBeGreaterThanOrEqual(before)
    expect(session.createdAt).toBeLessThanOrEqual(after)
    expect(session.lastActivityAt).toBe(session.createdAt)
  })

  it('should create and load a session', async () => {
    const created = await store.create(makeSession({ sessionId: 'sess-load', channel: 'cli' }))

    const loaded = await store.load(created.sessionId)
    expect(loaded).toBeDefined()
    expect(loaded!.sessionId).toBe('sess-load')
    expect(loaded!.channel).toBe('cli')
    expect(loaded!.owner).toBe('test-user')
  })

  it('should return undefined for non-existent session', async () => {
    const loaded = await store.load('no-such-session')
    expect(loaded).toBeUndefined()
  })

  it('should update session fields', async () => {
    const created = await store.create(makeSession({ sessionId: 'sess-upd' }))

    const updated = await store.update(created.sessionId, {
      activeRunId: 'run-42',
      modelConfig: { provider: 'anthropic', model: 'claude-4' },
    })

    expect(updated.activeRunId).toBe('run-42')
    expect(updated.modelConfig).toEqual({ provider: 'anthropic', model: 'claude-4' })
  })

  it('should preserve sessionId and createdAt on update', async () => {
    const created = await store.create(makeSession({ sessionId: 'sess-pres' }))

    const updated = await store.update(created.sessionId, {
      sessionId: 'HACKED' as string,
      createdAt: 0 as number,
      owner: 'new-owner',
    })

    expect(updated.sessionId).toBe('sess-pres')
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.owner).toBe('new-owner')
  })

  it('should throw when updating non-existent session', async () => {
    await expect(store.update('ghost', { owner: 'nobody' })).rejects.toThrow(
      'Session not found: ghost',
    )
  })

  it('should list all sessions', async () => {
    await store.create(makeSession({ sessionId: 'sess-a' }))
    await store.create(makeSession({ sessionId: 'sess-b' }))
    await store.create(makeSession({ sessionId: 'sess-c' }))

    const sessions = await store.list()
    expect(sessions).toHaveLength(3)
    const ids = sessions.map((s) => s.sessionId).sort()
    expect(ids).toEqual(['sess-a', 'sess-b', 'sess-c'])
  })

  it('should return empty list when no sessions exist', async () => {
    const sessions = await store.list()
    expect(sessions).toEqual([])
  })

  it('should touch to update lastActivityAt', async () => {
    const created = await store.create(makeSession({ sessionId: 'sess-touch' }))

    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 5))

    await store.touch(created.sessionId)

    const loaded = await store.load(created.sessionId)
    expect(loaded).toBeDefined()
    expect(loaded!.lastActivityAt).toBeGreaterThan(created.lastActivityAt)
    expect(loaded!.createdAt).toBe(created.createdAt)
  })

  it('should throw when touching non-existent session', async () => {
    await expect(store.touch('ghost')).rejects.toThrow('Session not found: ghost')
  })

  it('should handle all session types', async () => {
    const types = ['interactive', 'cron', 'subagent', 'background'] as const
    for (const sessionType of types) {
      const session = await store.create(
        makeSession({ sessionId: `sess-${sessionType}`, sessionType }),
      )
      const loaded = await store.load(session.sessionId)
      expect(loaded!.sessionType).toBe(sessionType)
    }
  })

  it('should preserve optional fields', async () => {
    const created = await store.create(
      makeSession({
        sessionId: 'sess-opt',
        channel: 'api',
        activeRunId: 'run-1',
        activeTaskId: 'task-1',
        modelConfig: { provider: 'openai', model: 'gpt-4' },
        policyContext: 'strict',
      }),
    )

    const loaded = await store.load(created.sessionId)
    expect(loaded!.channel).toBe('api')
    expect(loaded!.activeRunId).toBe('run-1')
    expect(loaded!.activeTaskId).toBe('task-1')
    expect(loaded!.modelConfig).toEqual({ provider: 'openai', model: 'gpt-4' })
    expect(loaded!.policyContext).toBe('strict')
  })
})
