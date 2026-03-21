import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ToolAuditLogger } from '../audit-logger.js'

/** Convenience alias for the static truncateResult method */
const truncateResult = ToolAuditLogger.truncateResult
import type { ToolAuditEntry } from '../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }
}

function makeAuditEntry(overrides: Partial<ToolAuditEntry> = {}): ToolAuditEntry {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    skillId: 'test-skill',
    skillVersion: '1.0.0',
    toolName: 'read_file',
    args: { path: '/src/index.ts' },
    result: {
      truncated: false,
      contentType: 'text/plain',
      content: 'file content here',
      originalSizeBytes: 17,
    },
    durationMs: 42,
    outcome: 'success',
    jobId: 'job-1',
    roundIndex: 0,
    agentId: 'agent-1',
    invocationId: 'inv-1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'audit-logger-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// ToolAuditLogger
// ---------------------------------------------------------------------------

describe('ToolAuditLogger', () => {
  describe('log', () => {
    it('logs an entry to a JSONL file', async () => {
      const logDir = join(tmpDir, 'audit')
      const auditLogger = new ToolAuditLogger(logDir, makeLogger())

      const entry = makeAuditEntry({
        id: 'audit-001',
        toolName: 'read_file',
        outcome: 'success',
      })
      await auditLogger.log(entry)

      // Read the JSONL file and verify
      const files = await findJsonlFiles(logDir)
      expect(files.length).toBeGreaterThanOrEqual(1)

      const content = await readFirstJsonlFile(logDir)
      const lines = content.trim().split('\n').filter(Boolean)
      expect(lines.length).toBe(1)

      const parsed = JSON.parse(lines[0])
      expect(parsed.id).toBe('audit-001')
      expect(parsed.toolName).toBe('read_file')
      expect(parsed.outcome).toBe('success')
    })

    it('creates the log directory if it does not exist', async () => {
      const logDir = join(tmpDir, 'deeply', 'nested', 'audit')
      const auditLogger = new ToolAuditLogger(logDir, makeLogger())

      const entry = makeAuditEntry()
      await auditLogger.log(entry)

      const content = await readFirstJsonlFile(logDir)
      expect(content.trim()).toBeTruthy()
    })

    it('appends multiple entries to the same file', async () => {
      const logDir = join(tmpDir, 'audit')
      const auditLogger = new ToolAuditLogger(logDir, makeLogger())

      const entry1 = makeAuditEntry({ id: 'audit-001', toolName: 'read_file' })
      const entry2 = makeAuditEntry({ id: 'audit-002', toolName: 'list_dir' })
      const entry3 = makeAuditEntry({ id: 'audit-003', toolName: 'search' })

      await auditLogger.log(entry1)
      await auditLogger.log(entry2)
      await auditLogger.log(entry3)

      const content = await readFirstJsonlFile(logDir)
      const lines = content.trim().split('\n').filter(Boolean)
      expect(lines.length).toBe(3)

      const parsed = lines.map((line) => JSON.parse(line))
      expect(parsed[0].id).toBe('audit-001')
      expect(parsed[1].id).toBe('audit-002')
      expect(parsed[2].id).toBe('audit-003')
    })
  })

  describe('queryByJob', () => {
    it('returns entries filtered by job ID', async () => {
      const logDir = join(tmpDir, 'audit')
      const auditLogger = new ToolAuditLogger(logDir, makeLogger())

      await auditLogger.log(makeAuditEntry({ id: 'a1', jobId: 'job-1' }))
      await auditLogger.log(makeAuditEntry({ id: 'a2', jobId: 'job-2' }))
      await auditLogger.log(makeAuditEntry({ id: 'a3', jobId: 'job-1' }))
      await auditLogger.log(makeAuditEntry({ id: 'a4', jobId: 'job-3' }))

      const results = await auditLogger.queryByJob('job-1')

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toEqual(['a1', 'a3'])
    })

    it('returns empty array when no entries match the job ID', async () => {
      const logDir = join(tmpDir, 'audit')
      const auditLogger = new ToolAuditLogger(logDir, makeLogger())

      await auditLogger.log(makeAuditEntry({ jobId: 'job-1' }))

      const results = await auditLogger.queryByJob('nonexistent-job')

      expect(results).toEqual([])
    })
  })

  describe('queryBySkill', () => {
    it('returns entries filtered by skill ID', async () => {
      const logDir = join(tmpDir, 'audit')
      const auditLogger = new ToolAuditLogger(logDir, makeLogger())

      await auditLogger.log(makeAuditEntry({ id: 'a1', skillId: 'dep-audit' }))
      await auditLogger.log(makeAuditEntry({ id: 'a2', skillId: 'code-review' }))
      await auditLogger.log(makeAuditEntry({ id: 'a3', skillId: 'dep-audit' }))

      const results = await auditLogger.queryBySkill('dep-audit')

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toEqual(['a1', 'a3'])
    })

    it('returns empty array when no entries match the skill ID', async () => {
      const logDir = join(tmpDir, 'audit')
      const auditLogger = new ToolAuditLogger(logDir, makeLogger())

      await auditLogger.log(makeAuditEntry({ skillId: 'dep-audit' }))

      const results = await auditLogger.queryBySkill('nonexistent-skill')

      expect(results).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// truncateResult
// ---------------------------------------------------------------------------

describe('truncateResult', () => {
  it('does not truncate content under 10KB', () => {
    const content = 'Hello, world!'
    const result = truncateResult(content)

    expect(result.truncated).toBe(false)
    expect(result.content).toBe(content)
    expect(result.contentType).toBe('text/plain')
    expect(result.originalSizeBytes).toBe(Buffer.byteLength(content, 'utf-8'))
  })

  it('does not truncate content exactly at 10KB', () => {
    const content = 'x'.repeat(10240)
    const result = truncateResult(content)

    expect(result.truncated).toBe(false)
    expect(result.content).toBe(content)
    expect(result.originalSizeBytes).toBe(10240)
  })

  it('truncates content over 10KB and appends truncation marker', () => {
    const content = 'A'.repeat(20_000)
    const result = truncateResult(content)

    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThan(content.length)
    expect(result.content).toContain('[TRUNCATED]')
    // The truncated content should start with the beginning of the original
    expect(result.content.startsWith('AAAA')).toBe(true)
  })

  it('tracks the original size in bytes when truncated', () => {
    const content = 'B'.repeat(20_000)
    const result = truncateResult(content)

    expect(result.originalSizeBytes).toBe(Buffer.byteLength(content, 'utf-8'))
    expect(result.truncated).toBe(true)
  })

  it('tracks the original size in bytes when not truncated', () => {
    const content = 'Short content'
    const result = truncateResult(content)

    expect(result.originalSizeBytes).toBe(Buffer.byteLength(content, 'utf-8'))
    expect(result.truncated).toBe(false)
  })

  it('handles multi-byte characters correctly for size calculation', () => {
    // Each emoji is 4 bytes in UTF-8
    const content = '\u{1F600}'.repeat(3000) // ~12KB in UTF-8
    const result = truncateResult(content)

    expect(result.originalSizeBytes).toBe(Buffer.byteLength(content, 'utf-8'))
    // Should be truncated since 3000 * 4 = 12000 > 10240
    expect(result.truncated).toBe(true)
  })

  it('respects a custom maxBytes parameter', () => {
    const content = 'Z'.repeat(200)
    const result = truncateResult(content, 100)

    expect(result.truncated).toBe(true)
    expect(result.originalSizeBytes).toBe(200)
    expect(result.content).toContain('[TRUNCATED]')
  })

  it('handles empty content', () => {
    const result = truncateResult('')

    expect(result.truncated).toBe(false)
    expect(result.content).toBe('')
    expect(result.originalSizeBytes).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// File-reading helpers
// ---------------------------------------------------------------------------

async function findJsonlFiles(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(dir, { recursive: true })
    return entries.filter((e) => e.endsWith('.jsonl'))
  } catch {
    return []
  }
}

async function readFirstJsonlFile(dir: string): Promise<string> {
  const files = await findJsonlFiles(dir)
  if (files.length === 0) {
    throw new Error(`No JSONL files found in ${dir}`)
  }
  return readFile(join(dir, files[0]), 'utf-8')
}
