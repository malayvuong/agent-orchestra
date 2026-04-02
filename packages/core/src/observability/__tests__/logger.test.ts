import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileLogger } from '../logger.js'
import type { LogEntry } from '../logger.js'

describe('FileLogger', () => {
  let baseDir: string

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  async function makeLogger(minLevel: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    baseDir = await mkdtemp(join(tmpdir(), 'ao-test-logger-'))
    const logPath = join(baseDir, 'test.log')
    return { logger: new FileLogger(logPath, minLevel), logPath }
  }

  async function readEntries(logPath: string): Promise<LogEntry[]> {
    const content = await readFile(logPath, 'utf-8')
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }

  it('should write JSONL to file', async () => {
    const { logger, logPath } = await makeLogger()
    logger.info('test-component', 'hello world')

    const entries = await readEntries(logPath)
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('info')
    expect(entries[0].component).toBe('test-component')
    expect(entries[0].message).toBe('hello world')
    expect(entries[0].timestamp).toBeDefined()
  })

  it('should filter by minLevel', async () => {
    const { logger, logPath } = await makeLogger('info')
    logger.debug('comp', 'should be filtered')
    logger.info('comp', 'should appear')

    const entries = await readEntries(logPath)
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('info')
  })

  it('should add context via child()', async () => {
    const { logger, logPath } = await makeLogger()
    const child = logger.child({ runId: 'run-1', sessionId: 'sess-1' })
    child.info('comp', 'child message')

    const entries = await readEntries(logPath)
    expect(entries).toHaveLength(1)
    expect(entries[0].runId).toBe('run-1')
    expect(entries[0].sessionId).toBe('sess-1')
  })

  it('should support all log levels', async () => {
    const { logger, logPath } = await makeLogger('debug')
    logger.debug('comp', 'debug msg')
    logger.info('comp', 'info msg')
    logger.warn('comp', 'warn msg')
    logger.error('comp', 'error msg')

    const entries = await readEntries(logPath)
    expect(entries).toHaveLength(4)
    expect(entries.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error'])
  })

  it('should include data when provided', async () => {
    const { logger, logPath } = await makeLogger()
    logger.info('comp', 'with data', { key: 'value', count: 42 })

    const entries = await readEntries(logPath)
    expect(entries[0].data).toEqual({ key: 'value', count: 42 })
  })

  it('should not include data key when not provided', async () => {
    const { logger, logPath } = await makeLogger()
    logger.info('comp', 'no data')

    const entries = await readEntries(logPath)
    expect(entries[0]).not.toHaveProperty('data')
  })
})
