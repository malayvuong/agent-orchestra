import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileTranscriptStore } from '../transcript-store.js'
import type { TranscriptEntry } from '../../types/runtime.js'

describe('FileTranscriptStore', () => {
  let baseDir: string
  let store: FileTranscriptStore

  const makeEntry = (
    overrides?: Partial<Omit<TranscriptEntry, 'id'>>,
  ): Omit<TranscriptEntry, 'id'> => ({
    role: 'user',
    timestamp: Date.now(),
    trustLevel: 'user_input',
    content: 'Hello world',
    ...overrides,
  })

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-transcriptstore-'))
    store = new FileTranscriptStore(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('should append an entry with auto-generated id', async () => {
    const entry = await store.append('sess-1', makeEntry({ content: 'Hi' }))

    expect(entry.id).toBeDefined()
    expect(entry.id.length).toBeGreaterThan(0)
    expect(entry.role).toBe('user')
    expect(entry.content).toBe('Hi')
    expect(entry.trustLevel).toBe('user_input')
  })

  it('should load entries by session', async () => {
    await store.append('sess-1', makeEntry({ content: 'msg-1' }))
    await store.append('sess-1', makeEntry({ content: 'msg-2', role: 'assistant' }))
    await store.append('sess-1', makeEntry({ content: 'msg-3' }))

    const entries = await store.loadBySession('sess-1')
    expect(entries).toHaveLength(3)
    expect(entries[0].content).toBe('msg-1')
    expect(entries[1].content).toBe('msg-2')
    expect(entries[1].role).toBe('assistant')
    expect(entries[2].content).toBe('msg-3')
  })

  it('should isolate entries between sessions', async () => {
    await store.append('sess-a', makeEntry({ content: 'A1' }))
    await store.append('sess-a', makeEntry({ content: 'A2' }))
    await store.append('sess-b', makeEntry({ content: 'B1' }))

    const entriesA = await store.loadBySession('sess-a')
    const entriesB = await store.loadBySession('sess-b')

    expect(entriesA).toHaveLength(2)
    expect(entriesB).toHaveLength(1)
  })

  it('should loadBySession with limit', async () => {
    await store.append('sess-1', makeEntry({ content: 'first' }))
    await store.append('sess-1', makeEntry({ content: 'second' }))
    await store.append('sess-1', makeEntry({ content: 'third' }))

    const entries = await store.loadBySession('sess-1', { limit: 2 })
    expect(entries).toHaveLength(2)
    expect(entries[0].content).toBe('first')
    expect(entries[1].content).toBe('second')
  })

  it('should loadBySession with afterTimestamp', async () => {
    const t1 = 1000
    const t2 = 2000
    const t3 = 3000

    await store.append('sess-1', makeEntry({ content: 'old', timestamp: t1 }))
    await store.append('sess-1', makeEntry({ content: 'mid', timestamp: t2 }))
    await store.append('sess-1', makeEntry({ content: 'new', timestamp: t3 }))

    const entries = await store.loadBySession('sess-1', { afterTimestamp: 1500 })
    expect(entries).toHaveLength(2)
    expect(entries[0].content).toBe('mid')
    expect(entries[1].content).toBe('new')
  })

  it('should loadBySession with both limit and afterTimestamp', async () => {
    await store.append('sess-1', makeEntry({ content: 'a', timestamp: 1000 }))
    await store.append('sess-1', makeEntry({ content: 'b', timestamp: 2000 }))
    await store.append('sess-1', makeEntry({ content: 'c', timestamp: 3000 }))
    await store.append('sess-1', makeEntry({ content: 'd', timestamp: 4000 }))

    const entries = await store.loadBySession('sess-1', {
      afterTimestamp: 1500,
      limit: 2,
    })
    expect(entries).toHaveLength(2)
    expect(entries[0].content).toBe('b')
    expect(entries[1].content).toBe('c')
  })

  it('should loadByRun across sessions', async () => {
    await store.append('sess-1', makeEntry({ content: 'r1-msg1', runId: 'run-1' }))
    await store.append('sess-1', makeEntry({ content: 'r2-msg1', runId: 'run-2' }))
    await store.append('sess-2', makeEntry({ content: 'r1-msg2', runId: 'run-1' }))

    const entries = await store.loadByRun('run-1')
    expect(entries).toHaveLength(2)
    const contents = entries.map((e) => e.content)
    expect(contents).toContain('r1-msg1')
    expect(contents).toContain('r1-msg2')
  })

  it('should return empty array for non-existent session', async () => {
    const entries = await store.loadBySession('no-such-session')
    expect(entries).toEqual([])
  })

  it('should return empty array for non-existent runId', async () => {
    const entries = await store.loadByRun('no-such-run')
    expect(entries).toEqual([])
  })

  it('should handle all roles and trust levels', async () => {
    const roles = ['user', 'assistant', 'system', 'tool'] as const
    const trustLevels = ['system', 'trusted_meta', 'user_input', 'external', 'automation'] as const

    for (const role of roles) {
      await store.append('sess-roles', makeEntry({ role, content: `role-${role}` }))
    }
    for (const trustLevel of trustLevels) {
      await store.append('sess-trust', makeEntry({ trustLevel, content: `trust-${trustLevel}` }))
    }

    const roleEntries = await store.loadBySession('sess-roles')
    expect(roleEntries).toHaveLength(4)

    const trustEntries = await store.loadBySession('sess-trust')
    expect(trustEntries).toHaveLength(5)
  })

  it('should preserve optional fields', async () => {
    await store.append(
      'sess-1',
      makeEntry({
        runId: 'run-42',
        taskId: 'task-7',
        toolName: 'readFile',
        content: { key: 'value', nested: { a: 1 } },
      }),
    )

    const loaded = await store.loadBySession('sess-1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].runId).toBe('run-42')
    expect(loaded[0].taskId).toBe('task-7')
    expect(loaded[0].toolName).toBe('readFile')
    expect(loaded[0].content).toEqual({ key: 'value', nested: { a: 1 } })
  })
})
