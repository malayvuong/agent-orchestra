/**
 * Policy engine barrel export.
 *
 * Re-exports all policy types, the engine class, system rules,
 * scope matcher, and configuration loader.
 */

// Types
export type {
  SkillCapability,
  CapabilityScope,
  SkillPolicyAction,
  SkillPolicyRule,
  SkillPolicy,
  PolicyEvaluation,
  NonOverridableRule,
} from './types.js'

// System rules and default policy
export { SYSTEM_RULES, DEFAULT_POLICY } from './system-rules.js'

// Scope matching
export { matchScope, matchGlob } from './scope-matcher.js'

// Policy engine
export { PolicyEngine } from './engine.js'

// Configuration loader
export { loadPolicyConfig } from './config-loader.js'
