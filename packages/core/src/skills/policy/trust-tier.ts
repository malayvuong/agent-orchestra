/**
 * Trust tier enforcement for registry-loaded skills.
 *
 * Each skill from the registry has a trust tier that restricts which
 * skill types (prompt, tool, plugin) are allowed. This module provides
 * validation logic and configuration override loading.
 *
 * Trust tiers (from most to least trusted):
 * - `official`      — prompt, tool, plugin allowed
 * - `verified`      — prompt, tool allowed (plugin blocked)
 * - `community`     — prompt only (tool/plugin blocked)
 * - `experimental`  — prompt only (with warning)
 *
 * @module
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillType } from '../types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trust tiers assigned to registry skills. */
export type TrustTier = 'official' | 'verified' | 'community' | 'experimental'

/** Result of validating a skill type against a trust tier. */
export type TrustTierValidation = {
  allowed: boolean
  reason?: string
}

/**
 * Configuration for trust tier overrides.
 *
 * Maps a skill ID to a promoted trust tier. This allows workspace owners
 * to explicitly elevate community skills to verified (or higher) when
 * they accept the associated risk.
 */
export type TrustTierConfig = {
  trustOverrides: Record<string, TrustTier>
}

// ---------------------------------------------------------------------------
// Tier-to-type restriction matrix
// ---------------------------------------------------------------------------

/**
 * Allowed skill types per trust tier.
 *
 * | Tier           | prompt | tool | plugin |
 * |----------------|--------|------|--------|
 * | official       |   yes  |  yes |  yes   |
 * | verified       |   yes  |  yes |  no    |
 * | community      |   yes  |  no  |  no    |
 * | experimental   |   yes  |  no  |  no    |
 */
const TIER_ALLOWED_TYPES: Record<TrustTier, ReadonlySet<SkillType>> = {
  official: new Set<SkillType>(['prompt', 'tool', 'plugin']),
  verified: new Set<SkillType>(['prompt', 'tool']),
  community: new Set<SkillType>(['prompt']),
  experimental: new Set<SkillType>(['prompt']),
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate whether a skill type is allowed under the given trust tier.
 *
 * @param skillType - The skill type to validate (prompt, tool, or plugin).
 * @param tier      - The trust tier assigned to the skill.
 * @returns Validation result with `allowed` flag and optional `reason`.
 */
export function validateTrustTier(skillType: SkillType, tier: TrustTier): TrustTierValidation {
  const allowedTypes = TIER_ALLOWED_TYPES[tier]

  if (allowedTypes.has(skillType)) {
    if (tier === 'experimental') {
      return {
        allowed: true,
        reason: `Experimental skill allowed as '${skillType}' — use with caution`,
      }
    }
    return { allowed: true }
  }

  // Build a human-readable reason for the denial
  if (skillType === 'plugin') {
    return {
      allowed: false,
      reason: `Plugin skills require 'official' trust tier (current: '${tier}')`,
    }
  }

  if (skillType === 'tool') {
    return {
      allowed: false,
      reason: `Tool skills require 'verified' or higher trust tier (current: '${tier}')`,
    }
  }

  return {
    allowed: false,
    reason: `Skill type '${skillType}' is not allowed under '${tier}' trust tier`,
  }
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/** Valid trust tier values for runtime validation. */
const VALID_TIERS = new Set<string>(['official', 'verified', 'community', 'experimental'])

/**
 * Load trust tier overrides from the workspace configuration file.
 *
 * Reads `.agent-orchestra/config.yaml` from the given workspace path
 * and extracts the `trustOverrides` section. Returns an empty Map if
 * the file does not exist or contains no overrides.
 *
 * The YAML parsing is intentionally simple (line-based key-value) to
 * avoid external dependencies. For production use, a full YAML parser
 * should be substituted.
 *
 * @param workspacePath - Absolute path to the workspace root.
 * @returns A Map of skill ID to overridden trust tier.
 */
export async function loadTrustOverrides(workspacePath: string): Promise<Map<string, TrustTier>> {
  const configPath = join(workspacePath, '.agent-orchestra', 'config.yaml')
  const overrides = new Map<string, TrustTier>()

  let content: string
  try {
    content = await readFile(configPath, 'utf-8')
  } catch {
    // File does not exist or is not readable — return empty overrides
    return overrides
  }

  // Simple line-based YAML parsing for the trustOverrides section
  const lines = content.split('\n')
  let inTrustOverrides = false

  for (const line of lines) {
    const trimmed = line.trimEnd()

    // Detect start of trustOverrides section
    if (/^trustOverrides\s*:/.test(trimmed)) {
      inTrustOverrides = true
      continue
    }

    // If we're in the trustOverrides section, parse key-value pairs
    if (inTrustOverrides) {
      // Exit section if we hit a non-indented line (new top-level key)
      if (trimmed.length > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
        break
      }

      // Match "  skill-id: tier"
      const match = trimmed.match(/^\s+([a-z0-9-]+)\s*:\s*(\S+)/)
      if (match) {
        const [, skillId, tier] = match
        if (skillId && tier && VALID_TIERS.has(tier)) {
          overrides.set(skillId, tier as TrustTier)
        }
      }
    }
  }

  return overrides
}
