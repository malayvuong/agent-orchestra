import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeDirectoryChecksum } from '../checksum.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = join(tmpdir(), `ao-test-checksum-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(tmpDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('computeDirectoryChecksum', () => {
  it('returns a sha256 checksum', async () => {
    await writeFile(join(tmpDir, 'SKILL.md'), 'hello')
    const result = await computeDirectoryChecksum(tmpDir)
    expect(result.algorithm).toBe('sha256')
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic — same content produces same hash', async () => {
    await writeFile(join(tmpDir, 'SKILL.md'), 'deterministic content')
    const hash1 = await computeDirectoryChecksum(tmpDir)
    const hash2 = await computeDirectoryChecksum(tmpDir)
    expect(hash1.digest).toBe(hash2.digest)
  })

  it('changes when file content changes', async () => {
    await writeFile(join(tmpDir, 'SKILL.md'), 'version 1')
    const hash1 = await computeDirectoryChecksum(tmpDir)

    await writeFile(join(tmpDir, 'SKILL.md'), 'version 2')
    const hash2 = await computeDirectoryChecksum(tmpDir)

    expect(hash1.digest).not.toBe(hash2.digest)
  })

  it('includes nested files', async () => {
    await writeFile(join(tmpDir, 'SKILL.md'), 'main')
    const hash1 = await computeDirectoryChecksum(tmpDir)

    await mkdir(join(tmpDir, 'references'), { recursive: true })
    await writeFile(join(tmpDir, 'references', 'extra.md'), 'extra')
    const hash2 = await computeDirectoryChecksum(tmpDir)

    expect(hash1.digest).not.toBe(hash2.digest)
  })

  it('changes when a file is renamed', async () => {
    await writeFile(join(tmpDir, 'a.txt'), 'content')
    const hash1 = await computeDirectoryChecksum(tmpDir)

    await rm(join(tmpDir, 'a.txt'))
    await writeFile(join(tmpDir, 'b.txt'), 'content')
    const hash2 = await computeDirectoryChecksum(tmpDir)

    expect(hash1.digest).not.toBe(hash2.digest)
  })
})
