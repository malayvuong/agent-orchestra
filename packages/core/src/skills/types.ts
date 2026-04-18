import type { AgentLens, AgentRole } from '../types/agent.js'

/** Spec Task 1.1 — only 'prompt' is implemented in Phase A */
export type SkillType = 'prompt' | 'tool' | 'plugin'

/** Spec Task 1.1 — only 'local' is implemented in Phase A */
export type SkillSource =
  | { type: 'local'; path: string }
  | { type: 'registry'; registryUrl: string; name: string }
  | { type: 'git'; repoUrl: string; ref: string; path: string }

export type SkillTrigger = {
  keywords?: string[]
  lenses?: AgentLens[]
  roles?: AgentRole[]
  lifecycle?: ('pre_round' | 'post_round' | 'pre_synthesis' | 'post_synthesis')[]
}

export type SkillDefinition = {
  id: string
  version: string
  name: string
  description: string
  skillType: SkillType
  source: SkillSource
  license?: string
  compatibility?: {
    agentOrchestra?: string
    platforms?: string[]
  }
  triggers?: SkillTrigger
  promptContent: string
  promptSummary: string
}

export type SkillSet = {
  id: string
  name: string
  description: string
  skillIds: string[]
  contextBudgetPercent: number // 0-100, default: 20
}

export type SkillLoadResult = {
  skills: SkillDefinition[]
  errors: { path: string; error: string }[]
  checksumFailures?: { skillId: string; expected: string; actual: string }[]
}

/**
 * Interface for checksum verification at load time (Phase B — Task B.3).
 * Defined in core to avoid circular dependency with registry package.
 * Implementors: LockfileManager in @malayvuong/agent-orchestra-registry.
 */
export type ChecksumEntry = {
  algorithm: 'sha256'
  digest: string
}

export interface ChecksumVerifier {
  /** Return the expected checksum for a skill, or null if not in lockfile. */
  getExpectedChecksum(skillId: string): Promise<ChecksumEntry | null>
  /** Compute the actual checksum of a skill directory. */
  computeChecksum(dirPath: string): Promise<ChecksumEntry>
}

export type SkillMatchResult = {
  matched: SkillDefinition[]
  reason: Map<string, string> // skillId → "lens:security" | "keyword:owasp" | etc.
}

export type SkillParseError = {
  type: 'parse_error'
  path: string
  message: string
  line?: number
}

// ---------------------------------------------------------------------------
// Security types — frozen in Phase A per security deliverables.
// Enforcement comes in Phase D; types are locked here to prevent schema drift.
// ---------------------------------------------------------------------------

/** @frozen Phase A — Capability types for skill permission model */
export type SkillCapability = 'fs.read' | 'fs.write' | 'proc.spawn' | 'net.http' | 'secrets.read'

export type CapabilityScope = {
  capability: SkillCapability
  /** Scoping constraint: path glob for fs.*, domain allowlist for net.http, command allowlist for proc.spawn */
  scope: string[]
}

export type SkillPolicyAction = 'allow' | 'deny' | 'require_approval'

export type SkillPolicyRule = {
  capability: SkillCapability
  action: SkillPolicyAction
  scope?: string[]
}

/** @frozen Phase A — deny-by-default policy contract */
export type SkillPolicy = {
  defaultAction: 'deny'
  rules: SkillPolicyRule[]
  maxExecutionMs: number
  networkAllowed: boolean
}

/** Non-overridable system rules — SSRF and dangerous command blocklists */
export const BLOCKED_NET_TARGETS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '169.254.169.254',
  'fd00::/8',
  '::1',
  '[::1]',
  'localhost',
  '0.0.0.0',
] as const

export const BLOCKED_PROC_COMMANDS = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf *',
  'sudo',
  'doas',
  'chmod 777',
  'chmod -R 777',
  'curl * | sh',
  'curl * | bash',
  'wget * | sh',
  'wget * | bash',
  'eval',
  'exec',
  'pkill',
  'kill -9',
  'mkfs',
  'dd if=*',
  ':(){ :|:& };:',
] as const

/**
 * Shell wrappers that can bypass command blocklists.
 * Matched as command prefixes — if a command starts with one of these
 * followed by a space, the inner command should also be checked.
 */
export const SHELL_WRAPPER_PREFIXES = [
  'bash -c',
  'sh -c',
  'zsh -c',
  'dash -c',
  'python -c',
  'python3 -c',
  'ruby -e',
  'perl -e',
  'node -e',
  'env',
  'nohup',
  'xargs',
] as const

export const BLOCKED_SECRET_PATHS = [
  '.env',
  '.env.*',
  '~/.ssh/*',
  '~/.aws/credentials',
  '~/.config/gcloud/*',
  '**/credentials.json',
] as const
