/**
 * Policy-specific types for the capability-based policy engine.
 *
 * IMPORTANT: SkillCapability, CapabilityScope, SkillPolicyAction,
 * SkillPolicyRule, and SkillPolicy are defined in ../types.ts (frozen in Phase A).
 * This module re-exports them for convenience and adds policy-evaluation types.
 */

import type {
  SkillCapability,
  CapabilityScope,
  SkillPolicyAction,
  SkillPolicyRule,
  SkillPolicy,
} from '../types.js'

// Re-export frozen types for consumer convenience
export type { SkillCapability, CapabilityScope, SkillPolicyAction, SkillPolicyRule, SkillPolicy }

/**
 * Result of evaluating a single capability request against a policy.
 *
 * Contains the determined action, the rule that matched (if any),
 * and a human-readable reason for the decision.
 */
export type PolicyEvaluation = {
  action: SkillPolicyAction
  matchedRule?: SkillPolicyRule
  capability: SkillCapability
  requestedScope: string[]
  reason: string
}

/**
 * A non-overridable system rule that blocks specific scopes for a capability.
 *
 * System rules are evaluated before any user-defined policy rules and cannot
 * be overridden by skill-level, skill-set-level, or job-level policies.
 */
export type NonOverridableRule = {
  capability: SkillCapability
  blockedScopes: string[]
  reason: string
}
