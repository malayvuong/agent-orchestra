import { cp, rm, readFile, mkdir } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'
import type { InstallSource, InstallResult, LockfileEntry } from './types.js'
import { computeDirectoryChecksum } from './checksum.js'
import type { LockfileManager } from './lockfile.js'
import { AGENT_ORCHESTRA_VERSION, isValidCalver } from '@malayvuong/agent-orchestra-shared'

const execFileAsync = promisify(execFile)

const SKILLS_DIR = '.agent-orchestra/skills'
const GIT_URL_RE = /^(https?:\/\/.+\.git|git@.+:.+\.git)(#(.+))?$/

/** Logger interface */
interface Logger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

/**
 * SkillInstaller handles installing skills from local paths and git URLs.
 * Phase B — Task B.2
 */
export class SkillInstaller {
  constructor(
    private workspacePath: string,
    private lockfileManager: LockfileManager,
    private logger?: Logger,
  ) {}

  private get skillsDir(): string {
    return join(this.workspacePath, SKILLS_DIR)
  }

  /**
   * Parse a source argument into an InstallSource.
   * Detects git URLs (ending in .git or containing github.com) vs local paths.
   * Supports git ref syntax: url#ref
   */
  parseSource(source: string): InstallSource {
    // Check for git URL patterns
    const gitMatch = source.match(GIT_URL_RE)
    if (gitMatch) {
      return { type: 'git', url: gitMatch[1], ref: gitMatch[3] }
    }

    // GitHub shorthand without .git suffix
    if (source.startsWith('https://github.com/') || source.startsWith('git@')) {
      const parts = source.split('#')
      return { type: 'git', url: parts[0], ref: parts[1] }
    }

    // Local path
    return { type: 'local', path: resolve(source) }
  }

  /**
   * Install a skill from a source (local path or git URL).
   */
  async install(source: InstallSource): Promise<InstallResult> {
    await mkdir(this.skillsDir, { recursive: true })

    if (source.type === 'local') {
      return this.installFromLocal(source.path)
    } else {
      return this.installFromGit(source.url, source.ref)
    }
  }

  /**
   * Remove an installed skill by ID.
   */
  async remove(skillId: string): Promise<boolean> {
    const skillPath = join(this.skillsDir, skillId)

    try {
      await rm(skillPath, { recursive: true, force: true })
    } catch (err) {
      this.logger?.error(`Failed to remove skill directory "${skillPath}": ${String(err)}`)
      return false
    }

    const removed = await this.lockfileManager.remove(skillId)
    if (!removed) {
      this.logger?.warn(`Skill "${skillId}" was not in lockfile (directory removed anyway)`)
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async installFromLocal(sourcePath: string): Promise<InstallResult> {
    // Validate source has SKILL.md
    const skillMdPath = join(sourcePath, 'SKILL.md')
    let rawContent: string
    try {
      rawContent = await readFile(skillMdPath, 'utf-8')
    } catch {
      throw new Error(`No SKILL.md found at "${sourcePath}". Is this a valid skill directory?`)
    }

    const meta = this.extractMeta(rawContent, sourcePath)
    const destPath = join(this.skillsDir, meta.skillId)

    // Copy skill directory (overwrite if exists and not pinned)
    this.logger?.info(`Copying ${meta.skillId} from local path...`)
    await rm(destPath, { recursive: true, force: true })
    await cp(sourcePath, destPath, { recursive: true })

    // Compute checksum of installed copy
    const checksum = await computeDirectoryChecksum(destPath)

    // Update lockfile
    const entry: LockfileEntry = {
      version: meta.version,
      source: 'local',
      path: `${SKILLS_DIR}/${meta.skillId}`,
      checksum,
      installedAt: new Date().toISOString(),
    }
    await this.lockfileManager.upsert(meta.skillId, entry)

    return {
      skillId: meta.skillId,
      version: meta.version,
      source: 'local',
      checksum,
      installedPath: destPath,
    }
  }

  private async installFromGit(url: string, ref?: string): Promise<InstallResult> {
    // Clone to a temp directory first
    const tmpDir = join(this.workspacePath, '.agent-orchestra', '.tmp-clone')
    await rm(tmpDir, { recursive: true, force: true })

    this.logger?.info(`Cloning from git${ref ? ` (ref: ${ref})` : ''}...`)

    const cloneArgs = ['clone', '--depth', '1']
    if (ref) {
      cloneArgs.push('--branch', ref)
    }
    cloneArgs.push(url, tmpDir)

    try {
      await execFileAsync('git', cloneArgs, { timeout: 60_000 })
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true })
      throw new Error(`Git clone failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      })
    }

    // Find SKILL.md — could be at root or in a subdirectory
    let skillSourceDir = tmpDir
    try {
      await readFile(join(tmpDir, 'SKILL.md'), 'utf-8')
    } catch {
      // Try common patterns: skills/<name>/, src/
      const repoName = basename(url.replace(/\.git$/, ''))
      const candidates = [join(tmpDir, 'skills', repoName), join(tmpDir, 'src'), tmpDir]
      let found = false
      for (const candidate of candidates) {
        try {
          await readFile(join(candidate, 'SKILL.md'), 'utf-8')
          skillSourceDir = candidate
          found = true
          break
        } catch {
          continue
        }
      }
      if (!found) {
        await rm(tmpDir, { recursive: true, force: true })
        throw new Error(`No SKILL.md found in cloned repository "${url}".`)
      }
    }

    // Read metadata
    const rawContent = await readFile(join(skillSourceDir, 'SKILL.md'), 'utf-8')
    const meta = this.extractMeta(rawContent, skillSourceDir)
    const destPath = join(this.skillsDir, meta.skillId)

    // Remove .git directory before copying
    await rm(join(skillSourceDir, '.git'), { recursive: true, force: true })

    // Copy to skills directory
    await rm(destPath, { recursive: true, force: true })
    await cp(skillSourceDir, destPath, { recursive: true })

    // Clean up temp
    await rm(tmpDir, { recursive: true, force: true })

    // Compute checksum
    const checksum = await computeDirectoryChecksum(destPath)

    // Update lockfile
    const entry: LockfileEntry = {
      version: meta.version,
      source: 'git',
      url,
      ref,
      path: `${SKILLS_DIR}/${meta.skillId}`,
      checksum,
      installedAt: new Date().toISOString(),
    }
    await this.lockfileManager.upsert(meta.skillId, entry)

    return {
      skillId: meta.skillId,
      version: meta.version,
      source: 'git',
      checksum,
      installedPath: destPath,
    }
  }

  /**
   * Extract skill ID and version from SKILL.md frontmatter.
   */
  private extractMeta(
    rawContent: string,
    sourcePath: string,
  ): { skillId: string; version: string } {
    const frontmatterMatch = rawContent.match(/^---\n([\s\S]*?)\n---/)
    if (!frontmatterMatch) {
      // Fall back to directory name
      const dirName = basename(sourcePath)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
      return { skillId: dirName, version: AGENT_ORCHESTRA_VERSION }
    }

    let meta: Record<string, unknown>
    try {
      meta = parseYaml(frontmatterMatch[1]) as Record<string, unknown>
    } catch {
      const dirName = basename(sourcePath)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
      return { skillId: dirName, version: AGENT_ORCHESTRA_VERSION }
    }

    const name = typeof meta.name === 'string' ? meta.name : basename(sourcePath)
    const skillId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const version =
      typeof meta.version === 'string'
        ? this.validateVersion(meta.version, sourcePath)
        : AGENT_ORCHESTRA_VERSION
    return { skillId, version }
  }

  private validateVersion(version: string, sourcePath: string): string {
    if (!isValidCalver(version)) {
      throw new Error(`Skill "${sourcePath}" version is not a valid CalVer: ${version}`)
    }
    return version
  }
}
