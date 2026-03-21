/** Phase B — Lockfile and installation types */

export type ChecksumAlgorithm = 'sha256'

export type Checksum = {
  algorithm: ChecksumAlgorithm
  digest: string
}

export type LockfileSkillSource = 'local' | 'git'

export type LockfileEntry = {
  version: string
  source: LockfileSkillSource
  /** Local path (relative to workspace) for local source */
  path?: string
  /** Git URL for git source */
  url?: string
  /** Git ref (tag, branch, or commit) for git source */
  ref?: string
  checksum: Checksum
  installedAt: string
  /** If true, this skill version is pinned and will not be overwritten */
  pinned?: boolean
}

export type Lockfile = {
  lockfileVersion: 1
  generatedAt: string
  skills: Record<string, LockfileEntry>
}

export type LockfileVerifyResult = {
  valid: { skillId: string; digest: string }[]
  mismatches: { skillId: string; expected: string; actual: string }[]
  missing: { skillId: string; reason: string }[]
}

export type InstallSource =
  | { type: 'local'; path: string }
  | { type: 'git'; url: string; ref?: string }

export type InstallResult = {
  skillId: string
  version: string
  source: LockfileSkillSource
  checksum: Checksum
  installedPath: string
}

// Phase E — Registry types

export type RegistryConfig = {
  registryUrl: string
  cacheDir: string
  cacheTtlSeconds: number
}

export type RegistrySkillEntry = {
  id: string
  name: string
  version: string
  description: string
  skillType: string
  license: string
  compatibility: { agentOrchestra: string }
  triggers?: Record<string, unknown>
  checksum: Checksum
  publishedAt: string
  author: string
  trustTier: string
  /** Phase F — deprecation/yank status info (absent means active) */
  statusInfo?: SkillStatusInfo
}

export type RegistryIndex = {
  version: number
  generatedAt: string
  skills: RegistrySkillEntry[]
  plugins: unknown[]
}

export type SkillPackage = {
  skillId: string
  version: string
  localPath: string
  checksum: Checksum
}

export type UpdateAvailable = {
  skillId: string
  currentVersion: string
  latestVersion: string
}

// Phase F — Deprecation/yank status

export type RegistrySkillStatus = 'active' | 'deprecated' | 'yanked'

export type SkillStatusInfo = {
  status: RegistrySkillStatus
  reason?: string
  /** Skill ID to use instead (for deprecated skills) */
  replacement?: string
  /** ISO date when the skill was yanked */
  yankedAt?: string
}
