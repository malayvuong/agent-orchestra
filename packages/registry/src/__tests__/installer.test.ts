import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SkillInstaller } from '../installer.js'
import { LockfileManager } from '../lockfile.js'

const execFileAsync = promisify(execFile)

let workspacePath: string
let sourceDir: string

beforeEach(async () => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  workspacePath = join(tmpdir(), `ao-test-installer-ws-${id}`)
  sourceDir = join(tmpdir(), `ao-test-installer-src-${id}`)
  await mkdir(workspacePath, { recursive: true })
  await mkdir(sourceDir, { recursive: true })
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
  await rm(sourceDir, { recursive: true, force: true })
})

function createSkillSource(
  dir: string,
  name: string,
  content: string = 'Skill body',
): Promise<string> {
  const skillDir = join(dir, name)
  return mkdir(skillDir, { recursive: true }).then(async () => {
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Test skill\nversion: "1.0.0"\nlicense: MIT\n---\n\n${content}`,
    )
    return skillDir
  })
}

describe('SkillInstaller', () => {
  describe('parseSource', () => {
    it('detects local paths', () => {
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager)
      const source = installer.parseSource('./my-skill')
      expect(source.type).toBe('local')
    })

    it('detects git URLs', () => {
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager)
      const source = installer.parseSource('https://github.com/example/skill.git')
      expect(source.type).toBe('git')
      if (source.type === 'git') {
        expect(source.url).toBe('https://github.com/example/skill.git')
      }
    })

    it('detects git URLs with ref', () => {
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager)
      const source = installer.parseSource('https://github.com/example/skill.git#v1.0.0')
      expect(source.type).toBe('git')
      if (source.type === 'git') {
        expect(source.url).toBe('https://github.com/example/skill.git')
        expect(source.ref).toBe('v1.0.0')
      }
    })

    it('detects GitHub URLs without .git suffix', () => {
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager)
      const source = installer.parseSource('https://github.com/example/skill')
      expect(source.type).toBe('git')
    })
  })

  describe('install from local path', () => {
    it('copies a skill directory and creates lockfile entry', async () => {
      const skillPath = await createSkillSource(sourceDir, 'my-local-skill')
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager)

      const result = await installer.install({ type: 'local', path: skillPath })

      expect(result.skillId).toBe('my-local-skill')
      expect(result.version).toBe('1.0.0')
      expect(result.source).toBe('local')
      expect(result.checksum.algorithm).toBe('sha256')
      expect(result.checksum.digest).toMatch(/^[a-f0-9]{64}$/)

      // Verify file was copied
      const installed = await readFile(
        join(workspacePath, '.agent-orchestra', 'skills', 'my-local-skill', 'SKILL.md'),
        'utf-8',
      )
      expect(installed).toContain('my-local-skill')

      // Verify lockfile was created
      lockfileManager.clearCache()
      const lockfile = await lockfileManager.read()
      expect(lockfile).not.toBeNull()
      expect(lockfile!.skills['my-local-skill']).toBeDefined()
      expect(lockfile!.skills['my-local-skill'].source).toBe('local')
    })

    it('throws when source has no SKILL.md', async () => {
      const emptyDir = join(sourceDir, 'empty')
      await mkdir(emptyDir, { recursive: true })
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager)

      await expect(installer.install({ type: 'local', path: emptyDir })).rejects.toThrow(
        'No SKILL.md found',
      )
    })
  })

  describe('install from git URL', () => {
    let bareRepoPath: string

    /**
     * Creates a bare git repo with a SKILL.md at the root.
     * Returns the file:// URL for the bare repo.
     */
    async function createBareGitRepo(
      name: string,
      body: string = 'Git skill body',
    ): Promise<string> {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const repoWork = join(tmpdir(), `ao-test-git-work-${id}`)
      bareRepoPath = join(tmpdir(), `ao-test-git-bare-${id}.git`)

      // Create a working repo, add a skill, then clone --bare
      await mkdir(repoWork, { recursive: true })
      await execFileAsync('git', ['init', repoWork])
      await execFileAsync('git', ['-C', repoWork, 'config', 'user.email', 'test@test.com'])
      await execFileAsync('git', ['-C', repoWork, 'config', 'user.name', 'Test'])
      await writeFile(
        join(repoWork, 'SKILL.md'),
        `---\nname: ${name}\ndescription: A git skill\nversion: "2.0.0"\nlicense: MIT\n---\n\n${body}`,
      )
      await execFileAsync('git', ['-C', repoWork, 'add', '.'])
      await execFileAsync('git', ['-C', repoWork, 'commit', '-m', 'init'])
      await execFileAsync('git', ['clone', '--bare', repoWork, bareRepoPath])

      // Clean up working copy
      await rm(repoWork, { recursive: true, force: true })

      return bareRepoPath
    }

    afterEach(async () => {
      if (bareRepoPath) {
        await rm(bareRepoPath, { recursive: true, force: true })
      }
    })

    it('installs a skill from a git repo and creates lockfile entry', async () => {
      const repoPath = await createBareGitRepo('git-skill', 'Git-sourced skill content')
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager, {
        info: () => {},
        warn: () => {},
        error: () => {},
      })

      const result = await installer.install({ type: 'git', url: repoPath })

      expect(result.skillId).toBe('git-skill')
      expect(result.version).toBe('2.0.0')
      expect(result.source).toBe('git')
      expect(result.checksum.algorithm).toBe('sha256')
      expect(result.checksum.digest).toMatch(/^[a-f0-9]{64}$/)

      // Verify the SKILL.md was installed (without .git directory)
      const installed = await readFile(
        join(workspacePath, '.agent-orchestra', 'skills', 'git-skill', 'SKILL.md'),
        'utf-8',
      )
      expect(installed).toContain('Git-sourced skill content')

      // .git directory should NOT be present in the installed copy
      await expect(
        access(join(workspacePath, '.agent-orchestra', 'skills', 'git-skill', '.git')),
      ).rejects.toThrow()

      // Verify lockfile entry
      lockfileManager.clearCache()
      const lockfile = await lockfileManager.read()
      expect(lockfile).not.toBeNull()
      expect(lockfile!.skills['git-skill']).toBeDefined()
      expect(lockfile!.skills['git-skill'].source).toBe('git')
      expect(lockfile!.skills['git-skill'].url).toBe(repoPath)
    })

    it('handles clone failure gracefully', async () => {
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager, {
        info: () => {},
        warn: () => {},
        error: () => {},
      })

      await expect(
        installer.install({ type: 'git', url: '/nonexistent/repo.git' }),
      ).rejects.toThrow('Git clone failed')
    })

    it('cleans up temp directory on clone failure', async () => {
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager, {
        info: () => {},
        warn: () => {},
        error: () => {},
      })

      try {
        await installer.install({ type: 'git', url: '/nonexistent/repo.git' })
      } catch {
        // expected
      }

      // Temp clone directory should be cleaned up
      await expect(access(join(workspacePath, '.agent-orchestra', '.tmp-clone'))).rejects.toThrow()
    })
  })

  describe('remove', () => {
    it('removes an installed skill and its lockfile entry', async () => {
      const skillPath = await createSkillSource(sourceDir, 'removable-skill')
      const lockfileManager = new LockfileManager(workspacePath)
      const installer = new SkillInstaller(workspacePath, lockfileManager)

      await installer.install({ type: 'local', path: skillPath })
      const removed = await installer.remove('removable-skill')

      expect(removed).toBe(true)

      // Verify directory is gone
      await expect(
        access(join(workspacePath, '.agent-orchestra', 'skills', 'removable-skill')),
      ).rejects.toThrow()

      // Verify lockfile entry is gone
      lockfileManager.clearCache()
      const lockfile = await lockfileManager.read()
      expect(lockfile!.skills['removable-skill']).toBeUndefined()
    })
  })
})
