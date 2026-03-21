/**
 * Plugin lifecycle hooks — barrel exports.
 *
 * Phase F — Task 4.2: Hook types and runner for integrating plugin
 * skills into the protocol pipeline at defined lifecycle points.
 */

export type { LifecyclePoint, HookContext, HookResult } from './types.js'

export { SkillHookRunner } from './hook-runner.js'
export type {
  HookSandboxRunner,
  HookSkillMatcher,
  HookPolicyEngine,
  HookLogger,
} from './hook-runner.js'
