import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileConversationStore } from '../conversation-store.js'
import type { AgentMessage } from '../../types/message.js'

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    jobId: 'job-1',
    roundIndex: 0,
    sender: 'architect-1',
    role: 'architect',
    state: 'analysis',
    timestamp: '2026-04-03T10:00:00.000Z',
    contentBlocks: [{ type: 'text', text: 'Test analysis output' }],
    findingCount: 0,
    ...overrides,
  }
}

describe('FileConversationStore', () => {
  let baseDir: string

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  async function makeStore() {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-conv-'))
    return new FileConversationStore(baseDir)
  }

  it('should round-trip append and loadByJob', async () => {
    const store = await makeStore()

    const msg1 = makeMessage({ id: 'msg-1', roundIndex: 0, sender: 'architect-1' })
    const msg2 = makeMessage({
      id: 'msg-2',
      roundIndex: 1,
      sender: 'reviewer-1',
      role: 'reviewer',
      state: 'review',
    })

    await store.append(msg1)
    await store.append(msg2)

    const messages = await store.loadByJob('job-1')
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('msg-1')
    expect(messages[1].id).toBe('msg-2')
    expect(messages[0].sender).toBe('architect-1')
    expect(messages[1].sender).toBe('reviewer-1')
  })

  it('should filter by afterRound', async () => {
    const store = await makeStore()

    await store.append(makeMessage({ id: 'msg-0', roundIndex: 0 }))
    await store.append(makeMessage({ id: 'msg-1', roundIndex: 1, state: 'review' }))
    await store.append(makeMessage({ id: 'msg-2', roundIndex: 2, state: 'rebuttal' }))

    const messages = await store.loadByJob('job-1', { afterRound: 0 })
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('msg-1')
    expect(messages[1].id).toBe('msg-2')
  })

  it('should filter by role', async () => {
    const store = await makeStore()

    await store.append(makeMessage({ id: 'msg-a', role: 'architect' }))
    await store.append(
      makeMessage({ id: 'msg-r', role: 'reviewer', sender: 'reviewer-1', state: 'review' }),
    )

    const messages = await store.loadByJob('job-1', { role: 'reviewer' })
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe('msg-r')
  })

  it('should filter by sender', async () => {
    const store = await makeStore()

    await store.append(makeMessage({ id: 'msg-a', sender: 'architect-1' }))
    await store.append(
      makeMessage({ id: 'msg-r', sender: 'reviewer-1', role: 'reviewer', state: 'review' }),
    )

    const messages = await store.loadByJob('job-1', { sender: 'architect-1' })
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe('msg-a')
  })

  it('should return [] for missing job', async () => {
    const store = await makeStore()
    const messages = await store.loadByJob('nonexistent-job')
    expect(messages).toEqual([])
  })

  it('should skip corrupt NDJSON lines', async () => {
    const store = await makeStore()
    const msg = makeMessage({ id: 'good-msg' })
    await store.append(msg)

    // Manually inject a corrupt line
    const filePath = join(baseDir, 'jobs', 'job-1', 'conversation.jsonl')
    const { appendFile } = await import('node:fs/promises')
    await appendFile(filePath, 'this is not json\n', 'utf-8')
    await store.append(makeMessage({ id: 'another-good', roundIndex: 1 }))

    const messages = await store.loadByJob('job-1')
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('good-msg')
    expect(messages[1].id).toBe('another-good')
  })

  it('should preserve contentBlocks structure', async () => {
    const store = await makeStore()

    const msg = makeMessage({
      contentBlocks: [
        { type: 'text', text: 'Some analysis' },
        {
          type: 'finding',
          finding: {
            id: 'f-1',
            title: 'Test finding',
            description: 'A test',
            scopeType: 'primary',
            actionability: 'must_fix_now',
            confidence: 'high',
          },
        },
      ],
      findingCount: 1,
    })
    await store.append(msg)

    const loaded = await store.loadByJob('job-1')
    expect(loaded[0].contentBlocks).toHaveLength(2)
    expect(loaded[0].contentBlocks[0].type).toBe('text')
    expect(loaded[0].contentBlocks[1].type).toBe('finding')
    expect(loaded[0].findingCount).toBe(1)
  })
})
