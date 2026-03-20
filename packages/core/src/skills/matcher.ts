import type { SkillDefinition, SkillMatchResult } from './types.js'
import type { AgentAssignment } from '../types/agent.js'

/** Spec Task 1.4 — Skill Matcher */

/** Priority levels for match ordering (lower number = higher priority) */
const PRIORITY_LENS = 1
const PRIORITY_ROLE = 2
const PRIORITY_KEYWORD = 3
const PRIORITY_LIFECYCLE = 4
const PRIORITY_ALWAYS_ON = 5

/**
 * SkillMatcher matches loaded skills to a specific agent based on
 * lens, role, keyword, and lifecycle triggers.
 *
 * Matching rules (OR logic — any trigger match activates the skill):
 * 1. If skill has triggers.lenses AND agent.lens is in the list → match
 * 2. If skill has triggers.roles AND agent.role is in the list → match
 * 3. If skill has triggers.keywords AND any keyword appears in job brief/targets → match
 * 4. If skill has triggers.lifecycle AND current lifecycle point matches → match
 * 5. If skill has NO triggers at all → always-on (matches every agent)
 *
 * Priority ordering (when multiple skills match):
 *   lens match > role match > keyword match > lifecycle match > always-on
 *   Within same priority: alphabetical by skill ID (deterministic)
 */
export class SkillMatcher {
  /**
   * Given a set of loaded skills and an agent assignment,
   * return the skills that match this agent's lens/role.
   */
  match(
    skills: SkillDefinition[],
    agent: AgentAssignment,
    context: { jobBrief: string; lifecyclePoint?: string },
  ): SkillMatchResult {
    if (skills.length === 0) {
      return { matched: [], reason: new Map() }
    }

    type MatchEntry = {
      skill: SkillDefinition
      reason: string
      priority: number
    }

    const entries: MatchEntry[] = []

    for (const skill of skills) {
      const triggers = skill.triggers

      // Always-on: triggers is undefined or all arrays are empty/undefined
      if (this.isAlwaysOn(triggers)) {
        entries.push({
          skill,
          reason: 'always-on',
          priority: PRIORITY_ALWAYS_ON,
        })
        continue
      }

      // Triggered skill — OR logic: first matching trigger wins (for reason), but
      // we want the *highest* priority reason if multiple triggers match.
      let bestPriority = Infinity
      let bestReason = ''

      // 1. Lens match
      if (
        triggers?.lenses &&
        triggers.lenses.length > 0 &&
        agent.lens !== undefined &&
        triggers.lenses.includes(agent.lens)
      ) {
        if (PRIORITY_LENS < bestPriority) {
          bestPriority = PRIORITY_LENS
          bestReason = `lens:${agent.lens}`
        }
      }

      // 2. Role match
      if (triggers?.roles && triggers.roles.length > 0 && triggers.roles.includes(agent.role)) {
        if (PRIORITY_ROLE < bestPriority) {
          bestPriority = PRIORITY_ROLE
          bestReason = `role:${agent.role}`
        }
      }

      // 3. Keyword match
      if (triggers?.keywords && triggers.keywords.length > 0) {
        for (const keyword of triggers.keywords) {
          if (this.matchKeyword(keyword, context.jobBrief)) {
            if (PRIORITY_KEYWORD < bestPriority) {
              bestPriority = PRIORITY_KEYWORD
              bestReason = `keyword:${keyword.toLowerCase()}`
            }
            break
          }
        }
      }

      // 4. Lifecycle match
      if (
        triggers?.lifecycle &&
        triggers.lifecycle.length > 0 &&
        context.lifecyclePoint !== undefined &&
        triggers.lifecycle.includes(
          context.lifecyclePoint as 'pre_round' | 'post_round' | 'pre_synthesis' | 'post_synthesis',
        )
      ) {
        if (PRIORITY_LIFECYCLE < bestPriority) {
          bestPriority = PRIORITY_LIFECYCLE
          bestReason = `lifecycle:${context.lifecyclePoint}`
        }
      }

      if (bestPriority !== Infinity) {
        entries.push({ skill, reason: bestReason, priority: bestPriority })
      }
    }

    // Sort by priority (ascending), then alphabetically by skill ID within same priority
    entries.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return a.skill.id.localeCompare(b.skill.id)
    })

    const matched = entries.map((e) => e.skill)
    const reason = new Map<string, string>(entries.map((e) => [e.skill.id, e.reason]))

    return { matched, reason }
  }

  /**
   * Check if a specific keyword appears in the job context.
   * Case-insensitive, word-boundary matching.
   * "sql" matches "SQL injection" but NOT "dismissal".
   */
  matchKeyword(keyword: string, text: string): boolean {
    // Escape any regex special characters in the keyword
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Use word-boundary anchors for whole-word matching; use 'i' flag for case-insensitivity
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    return regex.test(text)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Returns true if the skill should always match (no effective triggers). */
  private isAlwaysOn(triggers: SkillDefinition['triggers']): boolean {
    if (triggers === undefined) return true

    const hasLenses = (triggers.lenses?.length ?? 0) > 0
    const hasRoles = (triggers.roles?.length ?? 0) > 0
    const hasKeywords = (triggers.keywords?.length ?? 0) > 0
    const hasLifecycle = (triggers.lifecycle?.length ?? 0) > 0

    return !hasLenses && !hasRoles && !hasKeywords && !hasLifecycle
  }
}
