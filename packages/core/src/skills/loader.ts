import { readdir, readFile, stat, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { constants } from 'node:fs'
import type {
  SkillDefinition,
  SkillLoadResult,
  SkillParseError,
  ChecksumVerifier,
} from './types.js'
import type { SkillParser } from './parser.js'
import type { SkillParseResult } from './parser.js'

/** Spec Task 1.3 — Skill Loader */

/** Valid skill ID pattern: lowercase alphanumeric and hyphens only */
const VALID_SKILL_ID_RE = /^[a-z0-9-]+$/

/** Logger interface for warnings and errors */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

/**
 * SkillLoader discovers and loads skills from a workspace directory.
 * Supports loading from project-level and user-level skill directories.
 */
export class SkillLoader {
  private cache = new Map<string, SkillDefinition>()

  constructor(
    private parser: SkillParser,
    private logger?: Logger,
    private checksumVerifier?: ChecksumVerifier,
  ) {}

  /**
   * Load all skills from a workspace directory.
   * Scans the following directories in priority order:
   *   1. <workspace>/.agent-orchestra/skills/   (project-level, primary)
   *   2. <workspace>/.agents/skills/            (Agent Skills standard path)
   *   3. ~/.agent-orchestra/skills/             (user-level, global)
   *
   * If the same skill ID is found in multiple locations, project-level wins over user-level.
   * Warns on duplicates.
   */
  async loadFromWorkspace(workspacePath: string): Promise<SkillLoadResult> {
    const errors: { path: string; error: string }[] = []
    // Map from skillId to { skill, priority } to handle precedence
    // Lower priority number = higher precedence
    const skillMap = new Map<string, { skill: SkillDefinition; priority: number }>()

    const searchPaths = [
      { path: join(workspacePath, '.agent-orchestra', 'skills'), priority: 0 }, // project-level primary
      { path: join(workspacePath, '.agents', 'skills'), priority: 1 }, // agent skills standard
      { path: join(homedir(), '.agent-orchestra', 'skills'), priority: 2 }, // user-level global
    ]

    for (const { path: basePath, priority } of searchPaths) {
      let skillDirs: string[]
      try {
        skillDirs = await this.discoverSkillDirs(basePath)
      } catch {
        // Directory not accessible or doesn't exist — not an error
        continue
      }

      for (const dirPath of skillDirs) {
        const result = await this.loadFromDirectory(dirPath)

        if (isParseError(result)) {
          errors.push({ path: dirPath, error: result.message })
          this.logger?.error(`Failed to load skill from "${dirPath}": ${result.message}`)
          continue
        }

        const skill = result
        const existingEntry = skillMap.get(skill.id)

        if (existingEntry !== undefined) {
          if (priority < existingEntry.priority) {
            // Higher-priority source overrides
            this.logger?.warn(
              `Duplicate skill ID "${skill.id}" found in "${dirPath}" overrides previous definition`,
            )
            skillMap.set(skill.id, { skill, priority })
          } else {
            // Lower-priority source is skipped
            this.logger?.warn(
              `Duplicate skill ID "${skill.id}" found in "${dirPath}" — project-level definition takes precedence`,
            )
          }
        } else {
          skillMap.set(skill.id, { skill, priority })
        }
      }
    }

    let skills = Array.from(skillMap.values()).map((entry) => entry.skill)

    // Phase B — Task B.3: Checksum verification at load time
    const checksumFailures: { skillId: string; expected: string; actual: string }[] = []
    if (this.checksumVerifier) {
      const verified: SkillDefinition[] = []
      for (const skill of skills) {
        const expected = await this.checksumVerifier.getExpectedChecksum(skill.id)
        if (!expected) {
          // Not in lockfile — skill is not installed via registry, allow it
          verified.push(skill)
          continue
        }

        try {
          if (skill.source.type !== 'local') {
            // Only local sources can be checksum-verified at load time
            verified.push(skill)
            continue
          }
          const skillDir = skill.source.path.replace(/\/SKILL\.md$/, '')
          const actual = await this.checksumVerifier.computeChecksum(skillDir)

          if (actual.digest === expected.digest) {
            verified.push(skill)
          } else {
            checksumFailures.push({
              skillId: skill.id,
              expected: expected.digest,
              actual: actual.digest,
            })
            this.logger?.error(
              `Checksum mismatch for skill "${skill.id}": expected ${expected.digest.slice(0, 12)}..., got ${actual.digest.slice(0, 12)}...`,
            )
          }
        } catch (err) {
          // If we can't compute checksum, allow the skill but warn
          this.logger?.warn(`Could not verify checksum for skill "${skill.id}": ${String(err)}`)
          verified.push(skill)
        }
      }
      skills = verified
    }

    // Populate the cache
    for (const skill of skills) {
      this.cache.set(skill.id, skill)
    }

    return {
      skills,
      errors,
      checksumFailures: checksumFailures.length > 0 ? checksumFailures : undefined,
    }
  }

  /**
   * Load a single skill from a directory path.
   * Reads SKILL.md, parses it, and overrides skill ID with the directory name.
   * Returns the SkillDefinition or a SkillParseError.
   */
  async loadFromDirectory(dirPath: string): Promise<SkillDefinition | SkillParseError> {
    const skillFilePath = join(dirPath, 'SKILL.md')

    // Check readability
    try {
      await access(skillFilePath, constants.R_OK)
    } catch (err) {
      const message =
        isNodeError(err) && err.code === 'EACCES'
          ? `Permission denied reading "${skillFilePath}"`
          : `Cannot access "${skillFilePath}": ${String(err)}`

      this.logger?.warn(message)
      return {
        type: 'parse_error',
        path: skillFilePath,
        message,
      }
    }

    // Check file size before reading — reject files over 1MB to prevent memory issues
    const MAX_SKILL_FILE_SIZE = 1_048_576 // 1MB
    try {
      const fileStat = await stat(skillFilePath)
      if (fileStat.size > MAX_SKILL_FILE_SIZE) {
        const message = `SKILL.md at "${skillFilePath}" is ${(fileStat.size / 1024).toFixed(0)}KB — exceeds 1MB limit`
        this.logger?.warn(message)
        return {
          type: 'parse_error',
          path: skillFilePath,
          message,
        }
      }
    } catch {
      // stat failure is handled below by readFile
    }

    let rawContent: string
    try {
      rawContent = await readFile(skillFilePath, 'utf-8')
    } catch (err) {
      const message = `Failed to read "${skillFilePath}": ${String(err)}`
      this.logger?.error(message)
      return {
        type: 'parse_error',
        path: skillFilePath,
        message,
      }
    }

    const parseResult = this.parser.parse(skillFilePath, rawContent)

    if (isParseError(parseResult)) {
      return parseResult
    }

    const { skill } = parseResult as SkillParseResult

    // Override skill ID with the directory name (Task 1.3.3)
    const dirName = basename(dirPath)
    const skillId = dirName.toLowerCase()

    // Validate skill ID format: must be [a-z0-9-]+
    if (!VALID_SKILL_ID_RE.test(skillId)) {
      const message = `Invalid skill ID "${skillId}" derived from directory name "${dirName}" — must match [a-z0-9-]+`
      this.logger?.error(message)
      return {
        type: 'parse_error',
        path: skillFilePath,
        message,
      }
    }

    return { ...skill, id: skillId }
  }

  /**
   * Discover skill directories within a base path.
   * Returns paths to directories that contain a SKILL.md file.
   */
  async discoverSkillDirs(basePath: string): Promise<string[]> {
    // Check if base path exists and is accessible
    try {
      await access(basePath, constants.R_OK)
    } catch (err) {
      if (isNodeError(err) && err.code === 'EACCES') {
        this.logger?.warn(`Permission denied accessing skills directory "${basePath}"`)
      }
      // Directory doesn't exist or not accessible — return empty (not an error)
      return []
    }

    let entries: string[]
    try {
      entries = await readdir(basePath)
    } catch (err) {
      if (isNodeError(err) && err.code === 'EACCES') {
        this.logger?.warn(`Permission denied reading skills directory "${basePath}"`)
      }
      return []
    }

    const skillDirs: string[] = []

    for (const entry of entries) {
      const entryPath = join(basePath, entry)

      try {
        const entryStat = await stat(entryPath)
        if (!entryStat.isDirectory()) {
          continue
        }
      } catch {
        // Can't stat — skip
        continue
      }

      // Check if this directory contains SKILL.md
      const skillFilePath = join(entryPath, 'SKILL.md')
      try {
        await access(skillFilePath, constants.R_OK)
        skillDirs.push(entryPath)
      } catch {
        // No SKILL.md or not readable — not a skill directory
      }
    }

    return skillDirs
  }

  /** Get the in-memory skill cache */
  getCache(): SkillDefinition[] {
    return Array.from(this.cache.values())
  }

  /** Clear the cache */
  clearCache(): void {
    this.cache.clear()
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isParseError(
  result: SkillDefinition | SkillParseError | SkillParseResult,
): result is SkillParseError {
  return (
    result !== null &&
    typeof result === 'object' &&
    'type' in result &&
    (result as SkillParseError).type === 'parse_error'
  )
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
