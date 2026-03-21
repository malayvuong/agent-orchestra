import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Lockfile, LockfileEntry, LockfileVerifyResult } from './types.js'
import { computeDirectoryChecksum } from './checksum.js'

const LOCKFILE_NAME = 'skills.lock'

/** Logger interface */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

/**
 * Manages the skills.lock file for reproducible skill installations.
 * Phase B — Task B.1
 */
export class LockfileManager {
  private lockfile: Lockfile | null = null

  constructor(
    private workspacePath: string,
    private logger?: Logger,
  ) {}

  private get lockfilePath(): string {
    return join(this.workspacePath, LOCKFILE_NAME)
  }

  /**
   * Read existing lockfile from disk. Returns null if not found.
   * Caches in memory after first read.
   */
  async read(): Promise<Lockfile | null> {
    if (this.lockfile !== null) return this.lockfile

    let raw: string
    try {
      raw = await readFile(this.lockfilePath, 'utf-8')
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null
      }
      this.logger?.warn(`Failed to read lockfile: ${String(err)}`)
      return null
    }

    try {
      const parsed = parseYaml(raw) as Lockfile
      if (parsed?.lockfileVersion !== 1) {
        this.logger?.warn(`Unsupported lockfile version: ${parsed?.lockfileVersion}`)
        return null
      }
      this.lockfile = parsed
      return this.lockfile
    } catch (err) {
      this.logger?.warn(`Invalid YAML in lockfile: ${String(err)}`)
      return null
    }
  }

  /**
   * Write lockfile to disk. Also updates the in-memory cache.
   */
  async write(lockfile: Lockfile): Promise<void> {
    lockfile.generatedAt = new Date().toISOString()
    const content = `# AUTO-GENERATED — do not edit manually\n# Run 'agent-orchestra skills install' to regenerate\n${stringifyYaml(lockfile)}`
    await writeFile(this.lockfilePath, content, 'utf-8')
    this.lockfile = lockfile
  }

  /**
   * Get the current lockfile, creating an empty one if it doesn't exist.
   */
  async getOrCreate(): Promise<Lockfile> {
    const existing = await this.read()
    if (existing) return existing

    const empty: Lockfile = {
      lockfileVersion: 1,
      generatedAt: new Date().toISOString(),
      skills: {},
    }
    this.lockfile = empty
    return empty
  }

  /**
   * Add or update a skill entry in the lockfile and write to disk.
   */
  async upsert(skillId: string, entry: LockfileEntry): Promise<void> {
    const lockfile = await this.getOrCreate()

    // Don't overwrite pinned skills unless explicitly requested
    const existing = lockfile.skills[skillId]
    if (existing?.pinned) {
      this.logger?.warn(
        `Skill "${skillId}" is pinned to v${existing.version}. Use 'skills pin' to change version or remove pin first.`,
      )
      return
    }

    lockfile.skills[skillId] = entry
    await this.write(lockfile)
  }

  /**
   * Remove a skill entry from the lockfile and write to disk.
   */
  async remove(skillId: string): Promise<boolean> {
    const lockfile = await this.read()
    if (!lockfile || !(skillId in lockfile.skills)) {
      return false
    }

    delete lockfile.skills[skillId]
    await this.write(lockfile)
    return true
  }

  /**
   * Pin a skill to its current version (prevents overwrite on reinstall).
   */
  async pin(skillId: string): Promise<boolean> {
    const lockfile = await this.read()
    if (!lockfile || !(skillId in lockfile.skills)) {
      this.logger?.error(`Skill "${skillId}" not found in lockfile — install it first.`)
      return false
    }

    lockfile.skills[skillId].pinned = true
    await this.write(lockfile)
    return true
  }

  /**
   * Unpin a skill (allows overwrite on reinstall).
   */
  async unpin(skillId: string): Promise<boolean> {
    const lockfile = await this.read()
    if (!lockfile || !(skillId in lockfile.skills)) {
      return false
    }

    delete lockfile.skills[skillId].pinned
    await this.write(lockfile)
    return true
  }

  /**
   * Verify all installed skills match their lockfile checksums.
   */
  async verify(): Promise<LockfileVerifyResult> {
    const lockfile = await this.read()
    const result: LockfileVerifyResult = {
      valid: [],
      mismatches: [],
      missing: [],
    }

    if (!lockfile) {
      return result
    }

    for (const [skillId, entry] of Object.entries(lockfile.skills)) {
      const skillPath = entry.path
        ? join(this.workspacePath, entry.path)
        : join(this.workspacePath, '.agent-orchestra', 'skills', skillId)

      try {
        const actual = await computeDirectoryChecksum(skillPath)

        if (actual.digest === entry.checksum.digest) {
          result.valid.push({ skillId, digest: actual.digest })
        } else {
          result.mismatches.push({
            skillId,
            expected: entry.checksum.digest,
            actual: actual.digest,
          })
        }
      } catch (err) {
        result.missing.push({
          skillId,
          reason:
            isNodeError(err) && err.code === 'ENOENT'
              ? 'Skill directory not found'
              : `Cannot access: ${String(err)}`,
        })
      }
    }

    return result
  }

  /** Clear the in-memory cache (forces re-read from disk) */
  clearCache(): void {
    this.lockfile = null
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
