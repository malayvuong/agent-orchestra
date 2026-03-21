import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LockfileManager } from '../lockfile.js'
import type { LockfileEntry } from '../types.js'

let workspacePath: string

function makeLockfileEntry(overrides: Partial<LockfileEntry> = {}): LockfileEntry {
  return {
    version: '1.0.0',
    source: 'local',
    path: '.agent-orchestra/skills/test-skill',
    checksum: { algorithm: 'sha256', digest: 'abc123def456' },
    installedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(async () => {
  workspacePath = join(
    tmpdir(),
    `ao-test-lockfile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(workspacePath, { recursive: true })
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('LockfileManager', () => {
  describe('read', () => {
    it('returns null when no lockfile exists', async () => {
      const manager = new LockfileManager(workspacePath)
      expect(await manager.read()).toBeNull()
    })

    it('reads a valid lockfile', async () => {
      await writeFile(
        join(workspacePath, 'skills.lock'),
        `lockfileVersion: 1\ngeneratedAt: "2026-01-01T00:00:00Z"\nskills:\n  test-skill:\n    version: "1.0.0"\n    source: local\n    path: .agent-orchestra/skills/test-skill\n    checksum:\n      algorithm: sha256\n      digest: abc123\n    installedAt: "2026-01-01T00:00:00Z"\n`,
      )
      const manager = new LockfileManager(workspacePath)
      const lockfile = await manager.read()
      expect(lockfile).not.toBeNull()
      expect(lockfile!.lockfileVersion).toBe(1)
      expect(lockfile!.skills['test-skill']).toBeDefined()
      expect(lockfile!.skills['test-skill'].version).toBe('1.0.0')
    })

    it('returns null for invalid YAML', async () => {
      await writeFile(join(workspacePath, 'skills.lock'), '{{invalid yaml')
      const warnings: string[] = []
      const manager = new LockfileManager(workspacePath, {
        warn: (msg) => warnings.push(msg),
        error: () => {},
      })
      expect(await manager.read()).toBeNull()
      expect(warnings.length).toBeGreaterThan(0)
    })

    it('returns null for unsupported lockfile version', async () => {
      await writeFile(join(workspacePath, 'skills.lock'), 'lockfileVersion: 99\nskills: {}')
      const warnings: string[] = []
      const manager = new LockfileManager(workspacePath, {
        warn: (msg) => warnings.push(msg),
        error: () => {},
      })
      expect(await manager.read()).toBeNull()
      expect(warnings.some((w) => w.includes('Unsupported'))).toBe(true)
    })
  })

  describe('write', () => {
    it('writes a lockfile to disk', async () => {
      const manager = new LockfileManager(workspacePath)
      await manager.write({
        lockfileVersion: 1,
        generatedAt: '',
        skills: {
          'test-skill': makeLockfileEntry(),
        },
      })

      const content = await readFile(join(workspacePath, 'skills.lock'), 'utf-8')
      expect(content).toContain('AUTO-GENERATED')
      expect(content).toContain('test-skill')
      expect(content).toContain('abc123def456')
    })
  })

  describe('upsert', () => {
    it('adds a new skill entry', async () => {
      const manager = new LockfileManager(workspacePath)
      await manager.upsert('new-skill', makeLockfileEntry({ version: '2.0.0' }))

      const lockfile = await manager.read()
      expect(lockfile!.skills['new-skill']).toBeDefined()
      expect(lockfile!.skills['new-skill'].version).toBe('2.0.0')
    })

    it('does not overwrite pinned skills', async () => {
      const manager = new LockfileManager(workspacePath)
      await manager.upsert('pinned-skill', makeLockfileEntry({ pinned: true, version: '1.0.0' }))

      const warnings: string[] = []
      const manager2 = new LockfileManager(workspacePath, {
        warn: (msg) => warnings.push(msg),
        error: () => {},
      })
      manager2.clearCache()
      await manager2.upsert('pinned-skill', makeLockfileEntry({ version: '2.0.0' }))

      const lockfile = await manager2.read()
      expect(lockfile!.skills['pinned-skill'].version).toBe('1.0.0')
      expect(warnings.some((w) => w.includes('pinned'))).toBe(true)
    })
  })

  describe('remove', () => {
    it('removes a skill entry', async () => {
      const manager = new LockfileManager(workspacePath)
      await manager.upsert('to-remove', makeLockfileEntry())
      const removed = await manager.remove('to-remove')

      expect(removed).toBe(true)
      const lockfile = await manager.read()
      expect(lockfile!.skills['to-remove']).toBeUndefined()
    })

    it('returns false when skill not in lockfile', async () => {
      const manager = new LockfileManager(workspacePath)
      expect(await manager.remove('nonexistent')).toBe(false)
    })
  })

  describe('pin / unpin', () => {
    it('pins a skill', async () => {
      const manager = new LockfileManager(workspacePath)
      await manager.upsert('pin-test', makeLockfileEntry())
      const pinned = await manager.pin('pin-test')

      expect(pinned).toBe(true)
      manager.clearCache()
      const lockfile = await manager.read()
      expect(lockfile!.skills['pin-test'].pinned).toBe(true)
    })

    it('unpins a skill', async () => {
      const manager = new LockfileManager(workspacePath)
      await manager.upsert('unpin-test', makeLockfileEntry({ pinned: true }))
      await manager.unpin('unpin-test')

      manager.clearCache()
      const lockfile = await manager.read()
      expect(lockfile!.skills['unpin-test'].pinned).toBeUndefined()
    })

    it('returns false for nonexistent skill', async () => {
      const manager = new LockfileManager(workspacePath)
      expect(await manager.pin('nonexistent')).toBe(false)
    })
  })

  describe('verify', () => {
    it('returns empty result when no lockfile exists', async () => {
      const manager = new LockfileManager(workspacePath)
      const result = await manager.verify()
      expect(result.valid).toHaveLength(0)
      expect(result.mismatches).toHaveLength(0)
      expect(result.missing).toHaveLength(0)
    })

    it('reports missing skill directory', async () => {
      const manager = new LockfileManager(workspacePath)
      await manager.upsert(
        'ghost-skill',
        makeLockfileEntry({
          path: '.agent-orchestra/skills/ghost-skill',
        }),
      )

      manager.clearCache()
      const result = await manager.verify()
      expect(result.missing).toHaveLength(1)
      expect(result.missing[0].skillId).toBe('ghost-skill')
    })

    it('validates matching checksum', async () => {
      // Create a real skill directory
      const skillDir = join(workspacePath, '.agent-orchestra', 'skills', 'real-skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: real-skill\ndescription: test\n---\nHello',
      )

      // Compute the real checksum and store it
      const { computeDirectoryChecksum } = await import('../checksum.js')
      const checksum = await computeDirectoryChecksum(skillDir)

      const manager = new LockfileManager(workspacePath)
      await manager.upsert(
        'real-skill',
        makeLockfileEntry({
          path: '.agent-orchestra/skills/real-skill',
          checksum,
        }),
      )

      manager.clearCache()
      const result = await manager.verify()
      expect(result.valid).toHaveLength(1)
      expect(result.valid[0].skillId).toBe('real-skill')
      expect(result.mismatches).toHaveLength(0)
    })

    it('detects checksum mismatch', async () => {
      // Create a real skill directory
      const skillDir = join(workspacePath, '.agent-orchestra', 'skills', 'tampered-skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: tampered\ndescription: test\n---\nOriginal',
      )

      const manager = new LockfileManager(workspacePath)
      await manager.upsert(
        'tampered-skill',
        makeLockfileEntry({
          path: '.agent-orchestra/skills/tampered-skill',
          checksum: { algorithm: 'sha256', digest: 'definitely-wrong-checksum' },
        }),
      )

      manager.clearCache()
      const result = await manager.verify()
      expect(result.mismatches).toHaveLength(1)
      expect(result.mismatches[0].skillId).toBe('tampered-skill')
      expect(result.mismatches[0].expected).toBe('definitely-wrong-checksum')
    })
  })
})
