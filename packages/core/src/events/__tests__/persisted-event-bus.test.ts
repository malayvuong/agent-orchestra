import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PersistedEventBus } from '../persisted-event-bus.js'
import type { JobUpdateEvent } from '../debate-events.js'

describe('PersistedEventBus', () => {
  let baseDir: string

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  async function makeBus() {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-pbus-'))
    const logPath = join(baseDir, 'events.jsonl')
    return { bus: new PersistedEventBus(logPath), logPath }
  }

  it('should emit and persist events to file', async () => {
    const { bus, logPath } = await makeBus()
    const handler = vi.fn()

    bus.on('job:update', handler)

    const event: JobUpdateEvent = {
      type: 'job:update',
      jobId: 'job-1',
      status: 'running',
      timestamp: new Date().toISOString(),
    }

    bus.emit('job:update', event)

    // Listener should have been called
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(event)

    // Event should be persisted on disk
    const content = await readFile(logPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)

    const persisted = JSON.parse(lines[0])
    expect(persisted._type).toBe('job:update')
    expect(persisted.jobId).toBe('job-1')
  })

  it('should replay persisted events', async () => {
    const { bus, logPath } = await makeBus()

    const event1: JobUpdateEvent = {
      type: 'job:update',
      jobId: 'job-1',
      status: 'running',
      timestamp: new Date().toISOString(),
    }

    const event2: JobUpdateEvent = {
      type: 'job:update',
      jobId: 'job-1',
      status: 'completed',
      timestamp: new Date().toISOString(),
    }

    bus.emit('job:update', event1)
    bus.emit('job:update', event2)

    // Create a new bus pointing to the same file and replay
    const bus2 = new PersistedEventBus(logPath)
    const replayed: Array<{ type: string; event: unknown }> = []
    const count = bus2.replay((type, event) => {
      replayed.push({ type, event })
    })

    expect(count).toBe(2)
    expect(replayed).toHaveLength(2)
    expect(replayed[0].type).toBe('job:update')
    expect(replayed[1].type).toBe('job:update')
  })

  it('should return 0 for replay on non-existent file', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-pbus-'))
    const logPath = join(baseDir, 'nonexistent.jsonl')
    const bus = new PersistedEventBus(logPath)

    const handler = vi.fn()
    const count = bus.replay(handler)

    expect(count).toBe(0)
    expect(handler).not.toHaveBeenCalled()
  })
})
