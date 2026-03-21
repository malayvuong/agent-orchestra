import { readFile, writeFile, mkdir, stat, rm, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  RegistryConfig,
  RegistryIndex,
  RegistrySkillEntry,
  SkillPackage,
  SkillStatusInfo,
  UpdateAvailable,
} from './types.js'
import { computeDirectoryChecksum } from './checksum.js'

const execFileAsync = promisify(execFile)

/** Logger interface consistent with other registry modules */
interface Logger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/nicemvp/agent-orchestra-registry/main/registry.json'
const DEFAULT_CACHE_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '.',
  '.agent-orchestra',
  'cache',
)
const DEFAULT_CACHE_TTL = 3600 // 1 hour

/**
 * Create a default RegistryConfig with sensible defaults.
 */
export function defaultRegistryConfig(overrides?: Partial<RegistryConfig>): RegistryConfig {
  return {
    registryUrl: overrides?.registryUrl ?? DEFAULT_REGISTRY_URL,
    cacheDir: overrides?.cacheDir ?? DEFAULT_CACHE_DIR,
    cacheTtlSeconds: overrides?.cacheTtlSeconds ?? DEFAULT_CACHE_TTL,
  }
}

/**
 * Compare two semver version strings.
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number)
  const partsB = b.replace(/^v/, '').split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Client for fetching, caching, and resolving skills from the remote registry.
 * Phase E — Task E.2
 */
export class RegistryClient {
  private readonly config: RegistryConfig
  private readonly logger?: Logger
  private etag: string | null = null

  constructor(config?: Partial<RegistryConfig>, logger?: Logger) {
    this.config = defaultRegistryConfig(config)
    this.logger = logger
  }

  /**
   * Fetch the latest registry index.
   * Uses local file cache with TTL-based expiry and HTTP ETag/If-None-Match.
   */
  async fetchIndex(): Promise<RegistryIndex> {
    const cacheFile = join(this.config.cacheDir, 'registry', 'registry.json')

    // Check if cached copy is still valid
    const cached = await this.readCachedIndex(cacheFile)
    if (cached) return cached

    // Fetch from remote
    this.logger?.info(`Fetching registry index from ${this.config.registryUrl}`)

    const headers: Record<string, string> = {}
    if (this.etag) {
      headers['If-None-Match'] = this.etag
    }

    let response: Response
    try {
      response = await fetch(this.config.registryUrl, { headers })
    } catch (err) {
      // If fetch fails and we have a stale cache, use it
      const stale = await this.readCachedIndex(cacheFile, true)
      if (stale) {
        this.logger?.warn('Network request failed, using stale cached index')
        return stale
      }
      throw new Error(
        `Failed to fetch registry index: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }

    // 304 Not Modified — cache is still valid
    if (response.status === 304) {
      const stale = await this.readCachedIndex(cacheFile, true)
      if (stale) return stale
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch registry index: HTTP ${response.status} ${response.statusText}`,
      )
    }

    // Store ETag for conditional requests
    const newEtag = response.headers.get('etag')
    if (newEtag) {
      this.etag = newEtag
    }

    const body = await response.text()
    const index = JSON.parse(body) as RegistryIndex

    // Write to cache
    await this.writeCachedIndex(cacheFile, body)

    return index
  }

  /**
   * Search skills by query string with optional filters.
   * Matches against skill name, id, and description (case-insensitive).
   */
  async search(
    query: string,
    filters?: {
      skillType?: string
      trustTier?: string
      lens?: string
    },
  ): Promise<RegistrySkillEntry[]> {
    const index = await this.fetchIndex()
    const lowerQuery = query.toLowerCase()

    return index.skills.filter((skill) => {
      // Text match on id, name, description
      const haystack = `${skill.id} ${skill.name} ${skill.description}`.toLowerCase()
      if (!haystack.includes(lowerQuery)) return false

      // Apply optional filters
      if (filters?.skillType && skill.skillType !== filters.skillType) {
        return false
      }
      if (filters?.trustTier && skill.trustTier !== filters.trustTier) {
        return false
      }
      if (filters?.lens) {
        const lenses = skill.triggers?.lenses
        if (!Array.isArray(lenses) || !lenses.includes(filters.lens)) {
          return false
        }
      }

      return true
    })
  }

  /**
   * Download a skill from the registry via git sparse checkout.
   * Verifies SHA-256 checksum after download.
   */
  async download(skillId: string, version?: string): Promise<SkillPackage> {
    const index = await this.fetchIndex()

    // Find matching entries
    const candidates = index.skills.filter((s) => s.id === skillId)
    if (candidates.length === 0) {
      throw new Error(`Skill "${skillId}" not found in registry.`)
    }

    // Resolve version: use specified or pick the highest semver
    let entry: RegistrySkillEntry
    if (version) {
      const exact = candidates.find((s) => s.version === version)
      if (!exact) {
        throw new Error(
          `Skill "${skillId}" version "${version}" not found. Available: ${candidates.map((s) => s.version).join(', ')}`,
        )
      }
      entry = exact
    } else {
      entry = [...candidates].sort((a, b) => compareSemver(b.version, a.version))[0]
    }

    const cacheSkillDir = join(this.config.cacheDir, 'skills', skillId, entry.version)

    // Check if already cached with valid checksum
    try {
      await stat(join(cacheSkillDir, 'SKILL.md'))
      const checksum = await computeDirectoryChecksum(cacheSkillDir)
      if (checksum.digest === entry.checksum.digest) {
        return {
          skillId: entry.id,
          version: entry.version,
          localPath: cacheSkillDir,
          checksum,
        }
      }
    } catch {
      // Not cached or checksum mismatch — download fresh
    }

    // Derive git repo URL from registry URL
    const repoUrl = this.deriveRepoUrl()
    const tmpDir = join(this.config.cacheDir, '.tmp-registry-clone')

    try {
      await rm(tmpDir, { recursive: true, force: true })

      // Sparse clone — only the skill directory
      await execFileAsync(
        'git',
        ['clone', '--depth', '1', '--filter=blob:none', '--sparse', repoUrl, tmpDir],
        { timeout: 60_000 },
      )

      await execFileAsync('git', ['-C', tmpDir, 'sparse-checkout', 'set', `skills/${skillId}`], {
        timeout: 10_000,
      })

      // Copy skill to cache
      const sourceDir = join(tmpDir, 'skills', skillId)
      await rm(cacheSkillDir, { recursive: true, force: true })
      await mkdir(cacheSkillDir, { recursive: true })
      await cp(sourceDir, cacheSkillDir, { recursive: true })

      // Clean up tmp
      await rm(tmpDir, { recursive: true, force: true })
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      throw new Error(
        `Failed to download skill "${skillId}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }

    // Verify checksum
    const checksum = await computeDirectoryChecksum(cacheSkillDir)
    if (checksum.digest !== entry.checksum.digest) {
      throw new Error(
        `Checksum mismatch for "${skillId}@${entry.version}": ` +
          `expected ${entry.checksum.digest.slice(0, 12)}..., ` +
          `got ${checksum.digest.slice(0, 12)}...`,
      )
    }

    return {
      skillId: entry.id,
      version: entry.version,
      localPath: cacheSkillDir,
      checksum,
    }
  }

  /**
   * Get all available versions of a skill in the registry.
   */
  async versions(skillId: string): Promise<string[]> {
    const index = await this.fetchIndex()
    return index.skills.filter((s) => s.id === skillId).map((s) => s.version)
  }

  /**
   * Check for updates to installed skills.
   * Compares installed versions against latest in the registry.
   * Returns list of skills with newer versions available.
   */
  async checkUpdates(
    installed: { skillId: string; version: string }[],
  ): Promise<UpdateAvailable[]> {
    const index = await this.fetchIndex()
    const updates: UpdateAvailable[] = []

    for (const inst of installed) {
      // Find all versions of this skill in the registry
      const candidates = index.skills.filter((s) => s.id === inst.skillId)
      if (candidates.length === 0) continue

      // Find the highest version
      const latest = [...candidates].sort((a, b) => compareSemver(b.version, a.version))[0]

      if (compareSemver(latest.version, inst.version) > 0) {
        updates.push({
          skillId: inst.skillId,
          currentVersion: inst.version,
          latestVersion: latest.version,
        })
      }
    }

    return updates
  }

  /**
   * Resolve a skill entry from the registry by ID and optional version.
   */
  async resolve(skillId: string, version?: string): Promise<RegistrySkillEntry | null> {
    const index = await this.fetchIndex()
    return index.skills.find((s) => s.id === skillId && (!version || s.version === version)) ?? null
  }

  /**
   * Check the deprecation/yank status of installed skills against the registry.
   * Returns a map of skill ID to status info for skills that have a non-active status,
   * and an 'active' status for skills that are healthy.
   *
   * Phase F — Task 4.7
   */
  async checkStatus(installed: { skillId: string }[]): Promise<Map<string, SkillStatusInfo>> {
    const index = await this.fetchIndex()
    const result = new Map<string, SkillStatusInfo>()

    for (const inst of installed) {
      // Find the skill in the registry (any version — status applies to all)
      const entry = index.skills.find((s) => s.id === inst.skillId)

      if (!entry) {
        // Skill not found in registry — treat as active (could be local-only)
        result.set(inst.skillId, { status: 'active' })
        continue
      }

      if (entry.statusInfo) {
        result.set(inst.skillId, entry.statusInfo)
      } else {
        result.set(inst.skillId, { status: 'active' })
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Read the cached registry index if it exists and is fresh.
   * @param ignoreTtl If true, return the cached index regardless of age.
   */
  private async readCachedIndex(
    cachePath: string,
    ignoreTtl = false,
  ): Promise<RegistryIndex | null> {
    try {
      const fileStat = await stat(cachePath)
      const ageSeconds = (Date.now() - fileStat.mtimeMs) / 1000

      if (!ignoreTtl && ageSeconds >= this.config.cacheTtlSeconds) {
        return null
      }

      const content = await readFile(cachePath, 'utf-8')
      return JSON.parse(content) as RegistryIndex
    } catch {
      return null
    }
  }

  /**
   * Write the registry index to the local cache.
   */
  private async writeCachedIndex(cachePath: string, content: string): Promise<void> {
    try {
      const dir = cachePath.substring(0, cachePath.lastIndexOf('/'))
      await mkdir(dir, { recursive: true })
      await writeFile(cachePath, content, 'utf-8')
    } catch (err) {
      this.logger?.warn(`Failed to write registry cache: ${String(err)}`)
    }
  }

  /**
   * Derive the git repo URL from the registry.json URL.
   */
  private deriveRepoUrl(): string {
    const url = this.config.registryUrl
    // https://raw.githubusercontent.com/<owner>/<repo>/main/registry.json
    const match = url.match(/https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\//)
    if (match) {
      return `https://github.com/${match[1]}/${match[2]}.git`
    }
    // Fallback: assume it's a GitHub repo URL already
    return url.replace(/\/registry\.json$/, '.git')
  }
}
