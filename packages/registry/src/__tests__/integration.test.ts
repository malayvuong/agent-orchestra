/**
 * Phase B — End-to-end integration test
 *
 * Exercises the full pipeline:
 *   install from local path → load with checksum verification → verify checksums → inject into context
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

import { SkillInstaller } from '../installer.js'
import { LockfileManager } from '../lockfile.js'
import { computeDirectoryChecksum } from '../checksum.js'
import type { ChecksumEntry } from '@malayvuong/agent-orchestra-core'

// We import core skill classes to exercise the full pipeline
// NOTE: These are imported as types/classes — the integration test spans both packages
import {
  SkillParser,
  SkillLoader,
  SkillMatcher,
  SkillInjector,
} from '@malayvuong/agent-orchestra-core'
import type { AgentAssignment } from '@malayvuong/agent-orchestra-core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tokenEstimator = { estimate: (text: string) => Math.ceil(text.length / 4) }

let workspacePath: string
let externalSkillDir: string

function skillMd(name: string, opts: { lens?: string; body?: string } = {}): string {
  const triggers = opts.lens ? `\ntriggers:\n  lenses:\n    - ${opts.lens}` : ''
  const body = opts.body ?? `Prompt content for ${name}. This is the skill body.`
  return `---\nname: ${name}\ndescription: A test skill for ${name}\nversion: "2026.3.1"\nlicense: MIT${triggers}\n---\n\n${body}`
}

/**
 * Adapter: wrap LockfileManager as a ChecksumVerifier for SkillLoader.
 * This is how a real consumer (CLI) would integrate the two packages.
 */
function makeChecksumVerifier(lockfileManager: LockfileManager) {
  return {
    async getExpectedChecksum(skillId: string): Promise<ChecksumEntry | null> {
      const lockfile = await lockfileManager.read()
      if (!lockfile || !(skillId in lockfile.skills)) return null
      return lockfile.skills[skillId].checksum as ChecksumEntry
    },
    async computeChecksum(dirPath: string): Promise<ChecksumEntry> {
      return computeDirectoryChecksum(dirPath) as Promise<ChecksumEntry>
    },
  }
}

beforeEach(async () => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  workspacePath = join(tmpdir(), `ao-e2e-ws-${id}`)
  externalSkillDir = join(tmpdir(), `ao-e2e-ext-${id}`)
  await mkdir(workspacePath, { recursive: true })
  await mkdir(externalSkillDir, { recursive: true })
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
  await rm(externalSkillDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase B — install → load → verify → inject pipeline', () => {
  it('installs a local skill, loads with checksum verification, and injects into context', async () => {
    // 1. Create an external skill source
    const sourceDir = join(externalSkillDir, 'security-review')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(
      join(sourceDir, 'SKILL.md'),
      skillMd('security-review', {
        lens: 'security',
        body: 'Check for OWASP Top 10 vulnerabilities. Review input validation and output encoding.',
      }),
    )

    // 2. Install via SkillInstaller
    const lockfileManager = new LockfileManager(workspacePath)
    const installer = new SkillInstaller(workspacePath, lockfileManager, {
      info: () => {},
      warn: () => {},
      error: () => {},
    })

    const installResult = await installer.install({ type: 'local', path: sourceDir })
    expect(installResult.skillId).toBe('security-review')
    expect(installResult.version).toBe('2026.3.1')
    expect(installResult.checksum.algorithm).toBe('sha256')
    expect(installResult.checksum.digest).toMatch(/^[a-f0-9]{64}$/)

    // 3. Verify lockfile was created
    lockfileManager.clearCache()
    const lockfile = await lockfileManager.read()
    expect(lockfile).not.toBeNull()
    expect(lockfile!.skills['security-review']).toBeDefined()
    expect(lockfile!.skills['security-review'].checksum.digest).toBe(installResult.checksum.digest)

    // 4. Load skills with checksum verification
    const parser = new SkillParser(tokenEstimator)
    const verifier = makeChecksumVerifier(new LockfileManager(workspacePath))
    const loader = new SkillLoader(parser, undefined, verifier)
    const loadResult = await loader.loadFromWorkspace(workspacePath)

    expect(loadResult.skills).toHaveLength(1)
    expect(loadResult.skills[0].id).toBe('security-review')
    expect(loadResult.checksumFailures).toBeUndefined()

    // 5. Match skills to agent
    const matcher = new SkillMatcher()
    const agent: AgentAssignment = {
      id: 'reviewer-1',
      agentConfigId: 'cfg-1',
      role: 'reviewer',
      lens: 'security',
      connectionType: 'api',
      providerKey: 'test',
      modelOrCommand: 'test',
      protocol: 'reviewer_wave',
      enabled: true,
      allowReferenceScan: false,
      canWriteCode: false,
    }

    const matchResult = matcher.match(loadResult.skills, agent, {
      jobBrief: 'Review for security issues',
    })
    expect(matchResult.matched).toHaveLength(1)
    expect(matchResult.reason.get('security-review')).toContain('lens')

    // 6. Inject into context
    const injector = new SkillInjector(tokenEstimator)
    const injected = injector.inject(matchResult, 5000)
    expect(injected.skillContext).toContain('OWASP Top 10')
    expect(injected.injectedIds).toContain('security-review')
    expect(injected.usedTokens).toBeGreaterThan(0)
  })

  it('rejects a tampered skill at load time via checksum verification', async () => {
    // 1. Install a skill
    const sourceDir = join(externalSkillDir, 'test-skill')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'SKILL.md'), skillMd('test-skill'))

    const lockfileManager = new LockfileManager(workspacePath)
    const installer = new SkillInstaller(workspacePath, lockfileManager, {
      info: () => {},
      warn: () => {},
      error: () => {},
    })

    await installer.install({ type: 'local', path: sourceDir })

    // 2. Tamper with the installed skill
    const installedPath = join(
      workspacePath,
      '.agent-orchestra',
      'skills',
      'test-skill',
      'SKILL.md',
    )
    const original = await readFile(installedPath, 'utf-8')
    await writeFile(installedPath, original + '\n\nMALICIOUS INJECTION')

    // 3. Load — should detect the tampered checksum
    const parser = new SkillParser(tokenEstimator)
    const errorCalls: string[] = []
    const logger = {
      warn: () => {},
      error: (msg: string) => errorCalls.push(msg),
    }
    const verifier = makeChecksumVerifier(new LockfileManager(workspacePath))
    const loader = new SkillLoader(parser, logger, verifier)
    const loadResult = await loader.loadFromWorkspace(workspacePath)

    expect(loadResult.skills).toHaveLength(0)
    expect(loadResult.checksumFailures).toBeDefined()
    expect(loadResult.checksumFailures).toHaveLength(1)
    expect(loadResult.checksumFailures![0].skillId).toBe('test-skill')
    expect(errorCalls.some((m) => m.includes('Checksum mismatch'))).toBe(true)
  })

  it('verify command detects tampered skills', async () => {
    // 1. Install
    const sourceDir = join(externalSkillDir, 'verify-skill')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'SKILL.md'), skillMd('verify-skill'))

    const lockfileManager = new LockfileManager(workspacePath)
    const installer = new SkillInstaller(workspacePath, lockfileManager, {
      info: () => {},
      warn: () => {},
      error: () => {},
    })

    await installer.install({ type: 'local', path: sourceDir })

    // 2. Verify — should pass
    lockfileManager.clearCache()
    const result1 = await lockfileManager.verify()
    expect(result1.valid).toHaveLength(1)
    expect(result1.mismatches).toHaveLength(0)

    // 3. Tamper
    const installedPath = join(
      workspacePath,
      '.agent-orchestra',
      'skills',
      'verify-skill',
      'SKILL.md',
    )
    await writeFile(installedPath, 'TAMPERED CONTENT')

    // 4. Verify again — should fail
    const freshManager = new LockfileManager(workspacePath)
    const result2 = await freshManager.verify()
    expect(result2.mismatches).toHaveLength(1)
    expect(result2.mismatches[0].skillId).toBe('verify-skill')
  })

  it('install → remove → verify is clean', async () => {
    // 1. Install
    const sourceDir = join(externalSkillDir, 'temp-skill')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'SKILL.md'), skillMd('temp-skill'))

    const lockfileManager = new LockfileManager(workspacePath)
    const installer = new SkillInstaller(workspacePath, lockfileManager, {
      info: () => {},
      warn: () => {},
      error: () => {},
    })

    await installer.install({ type: 'local', path: sourceDir })

    // 2. Remove
    const removed = await installer.remove('temp-skill')
    expect(removed).toBe(true)

    // 3. Verify lockfile is clean
    const freshManager = new LockfileManager(workspacePath)
    const lockfile = await freshManager.read()
    expect(lockfile!.skills['temp-skill']).toBeUndefined()

    // 4. Load — should find no skills
    const parser = new SkillParser(tokenEstimator)
    const loader = new SkillLoader(parser)
    const loadResult = await loader.loadFromWorkspace(workspacePath)
    expect(loadResult.skills).toHaveLength(0)
  })

  it('installs from git URL, loads with checksum verification, and injects into context', async () => {
    // 1. Create a bare git repo containing a skill
    const repoWork = join(externalSkillDir, 'git-work')
    const bareRepo = join(externalSkillDir, 'git-skill.git')
    await mkdir(repoWork, { recursive: true })
    await execFileAsync('git', ['init', repoWork])
    await execFileAsync('git', ['-C', repoWork, 'config', 'user.email', 'test@test.com'])
    await execFileAsync('git', ['-C', repoWork, 'config', 'user.name', 'Test'])
    await writeFile(
      join(repoWork, 'SKILL.md'),
      skillMd('git-review', {
        lens: 'security',
        body: 'Git-sourced security review skill. Check for SQL injection and XSS vulnerabilities.',
      }),
    )
    await execFileAsync('git', ['-C', repoWork, 'add', '.'])
    await execFileAsync('git', ['-C', repoWork, 'commit', '-m', 'init'])
    await execFileAsync('git', ['clone', '--bare', repoWork, bareRepo])

    // 2. Install from git
    const lockfileManager = new LockfileManager(workspacePath)
    const installer = new SkillInstaller(workspacePath, lockfileManager, {
      info: () => {},
      warn: () => {},
      error: () => {},
    })

    const installResult = await installer.install({ type: 'git', url: bareRepo })
    expect(installResult.skillId).toBe('git-review')
    expect(installResult.source).toBe('git')
    expect(installResult.checksum.digest).toMatch(/^[a-f0-9]{64}$/)

    // 3. .git directory should NOT be in installed copy
    await expect(
      access(join(workspacePath, '.agent-orchestra', 'skills', 'git-review', '.git')),
    ).rejects.toThrow()

    // 4. Verify lockfile tracks git source
    lockfileManager.clearCache()
    const lockfile = await lockfileManager.read()
    expect(lockfile!.skills['git-review'].source).toBe('git')
    expect(lockfile!.skills['git-review'].url).toBe(bareRepo)

    // 5. Load with checksum verification
    const parser = new SkillParser(tokenEstimator)
    const verifier = makeChecksumVerifier(new LockfileManager(workspacePath))
    const loader = new SkillLoader(parser, undefined, verifier)
    const loadResult = await loader.loadFromWorkspace(workspacePath)

    expect(loadResult.skills).toHaveLength(1)
    expect(loadResult.skills[0].id).toBe('git-review')

    // 6. Match + inject
    const matcher = new SkillMatcher()
    const agent: AgentAssignment = {
      id: 'git-reviewer',
      agentConfigId: 'cfg-1',
      role: 'reviewer',
      lens: 'security',
      connectionType: 'api',
      providerKey: 'test',
      modelOrCommand: 'test',
      protocol: 'reviewer_wave',
      enabled: true,
      allowReferenceScan: false,
      canWriteCode: false,
    }

    const matchResult = matcher.match(loadResult.skills, agent, {
      jobBrief: 'Security audit',
    })
    expect(matchResult.matched).toHaveLength(1)

    const injector = new SkillInjector(tokenEstimator)
    const injected = injector.inject(matchResult, 5000)
    expect(injected.skillContext).toContain('SQL injection')
    expect(injected.injectedIds).toContain('git-review')
  })

  it('pinned skill is not overwritten by reinstall', async () => {
    // 1. Install v1
    const sourceDir = join(externalSkillDir, 'pinnable')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'SKILL.md'), skillMd('pinnable', { body: 'Version 1 content' }))

    const lockfileManager = new LockfileManager(workspacePath)
    const installer = new SkillInstaller(workspacePath, lockfileManager, {
      info: () => {},
      warn: () => {},
      error: () => {},
    })

    const result1 = await installer.install({ type: 'local', path: sourceDir })
    const originalDigest = result1.checksum.digest

    // 2. Pin
    await lockfileManager.pin('pinnable')

    // 3. Modify source and try to reinstall
    await writeFile(
      join(sourceDir, 'SKILL.md'),
      skillMd('pinnable', { body: 'Version 2 content — different!' }),
    )

    const warnings: string[] = []
    const lockfileManager2 = new LockfileManager(workspacePath, {
      warn: (msg) => warnings.push(msg),
      error: () => {},
    })
    const installer2 = new SkillInstaller(workspacePath, lockfileManager2, {
      info: () => {},
      warn: () => {},
      error: () => {},
    })

    await installer2.install({ type: 'local', path: sourceDir })

    // 4. Lockfile should still have original digest (pinned)
    const freshManager = new LockfileManager(workspacePath)
    const lockfile = await freshManager.read()
    expect(lockfile!.skills['pinnable'].checksum.digest).toBe(originalDigest)
    expect(lockfile!.skills['pinnable'].pinned).toBe(true)
  })
})
