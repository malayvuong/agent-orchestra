/**
 * Policy Engine — evaluates skill invocations against capability-based rules.
 *
 * Evaluation order (deterministic, first-match):
 * 1. System rules (non-overridable) — deny if any scope matches a blocked entry
 * 2. Policy rules (first rule whose capability + scope matches wins)
 * 3. Default action (deny)
 *
 * The engine is stateless: all state comes from the policy and system rules
 * passed at evaluation time. This makes evaluation deterministic and testable.
 */

import type {
  CapabilityScope,
  SkillCapability,
  SkillPolicy,
  SkillPolicyAction,
  SkillPolicyRule,
} from '../types.js'
import type { NonOverridableRule, PolicyEvaluation } from './types.js'
import { SYSTEM_RULES, DEFAULT_POLICY } from './system-rules.js'
import { matchScope } from './scope-matcher.js'

/**
 * Capability-based policy engine for skill invocations.
 *
 * Enforces a deny-by-default security model where every capability request
 * must be explicitly allowed by a policy rule. Non-overridable system rules
 * provide baseline security guarantees (SSRF protection, dangerous command
 * blocking, secret file access prevention) that no user policy can override.
 */
export class PolicyEngine {
  private readonly systemRules: NonOverridableRule[]

  constructor() {
    this.systemRules = SYSTEM_RULES
  }

  /**
   * Evaluate a single capability request against a policy.
   *
   * Returns the action to take (allow, deny, require_approval) along with
   * the matched rule and a human-readable reason.
   *
   * Evaluation order:
   * 1. System rules (non-overridable) -> deny if any scope matches a blocked entry
   * 2. Policy rules (first match wins based on capability + scope)
   * 3. Default action (deny)
   *
   * @param capability - The capability being requested
   * @param scope - The scope values for the request (paths, IPs, commands)
   * @param policy - The policy to evaluate against
   * @returns The evaluation result with action, matched rule, and reason
   */
  evaluate(capability: SkillCapability, scope: string[], policy: SkillPolicy): PolicyEvaluation {
    // Step 1: Check system rules (non-overridable)
    const systemDenial = this.checkSystemRules(capability, scope)
    if (systemDenial) {
      return systemDenial
    }

    // Step 2: Check policy rules (first match wins)
    for (const rule of policy.rules) {
      if (rule.capability !== capability) {
        continue
      }

      // Rule without scope applies to all scopes for this capability
      if (!rule.scope || rule.scope.length === 0) {
        return {
          action: rule.action,
          matchedRule: rule,
          capability,
          requestedScope: scope,
          reason: `Policy rule matched: ${rule.action} ${capability}`,
        }
      }

      // Rule with scope: check if any requested scope matches any rule scope.
      // An empty requested scope MUST NOT match a scoped rule — otherwise a
      // skill that omits scope declarations would bypass scope constraints.
      const scopeMatches =
        scope.length > 0 &&
        scope.some((reqScope) =>
          rule.scope!.some((ruleScope) => matchScope(reqScope, ruleScope, capability)),
        )

      if (scopeMatches) {
        return {
          action: rule.action,
          matchedRule: rule,
          capability,
          requestedScope: scope,
          reason: `Policy rule matched: ${rule.action} ${capability} (scope: ${rule.scope.join(', ')})`,
        }
      }
    }

    // Step 3: Fall back to default action
    return {
      action: policy.defaultAction,
      capability,
      requestedScope: scope,
      reason: `No matching rule — default action: ${policy.defaultAction}`,
    }
  }

  /**
   * Evaluate all capabilities required by a skill invocation.
   *
   * Returns an array of evaluations — one per capability. Use
   * {@link getOverallAction} to determine the aggregate action.
   *
   * @param capabilities - The capability scopes required by the skill
   * @param policy - The policy to evaluate against
   * @returns Array of evaluation results, one per capability
   */
  evaluateInvocation(capabilities: CapabilityScope[], policy: SkillPolicy): PolicyEvaluation[] {
    return capabilities.map((cap) => this.evaluate(cap.capability, cap.scope, policy))
  }

  /**
   * Merge policies in priority order.
   *
   * More specific policies take precedence:
   * 1. Skill-level (from SkillDefinition.capabilitiesRequired)
   * 2. SkillSet-level (from SkillSet.policyOverrides)
   * 3. Job-level (from JobRuntimeConfig)
   *
   * Rules are concatenated with skill-level rules first (highest priority).
   * Since evaluation uses first-match, earlier rules win.
   *
   * System rules always apply on top (checked before any policy rules).
   *
   * @param skillPolicy - Skill-level policy (highest precedence)
   * @param skillSetPolicy - SkillSet-level policy
   * @param jobPolicy - Job-level policy (lowest precedence)
   * @returns Merged policy with rules ordered by precedence
   */
  mergePolicy(
    skillPolicy?: SkillPolicy,
    skillSetPolicy?: SkillPolicy,
    jobPolicy?: SkillPolicy,
  ): SkillPolicy {
    // If no policies provided, return default
    if (!skillPolicy && !skillSetPolicy && !jobPolicy) {
      return { ...DEFAULT_POLICY }
    }

    // Merge rules: skill-level first (highest priority), then skillSet, then job
    const mergedRules: SkillPolicyRule[] = [
      ...(skillPolicy?.rules ?? []),
      ...(skillSetPolicy?.rules ?? []),
      ...(jobPolicy?.rules ?? []),
    ]

    // Use the most specific policy's settings, falling back through the chain
    const base = skillPolicy ?? skillSetPolicy ?? jobPolicy ?? DEFAULT_POLICY

    return {
      defaultAction: 'deny', // Always deny-by-default, non-negotiable
      rules: mergedRules,
      maxExecutionMs:
        skillPolicy?.maxExecutionMs ??
        skillSetPolicy?.maxExecutionMs ??
        jobPolicy?.maxExecutionMs ??
        DEFAULT_POLICY.maxExecutionMs,
      networkAllowed: base.networkAllowed,
    }
  }

  /**
   * Determine the overall action from an array of evaluations.
   *
   * Priority: deny > require_approval > allow
   * - If ANY evaluation is 'deny', overall is 'deny'
   * - If ANY evaluation is 'require_approval', overall is 'require_approval'
   * - Only if ALL evaluations are 'allow', overall is 'allow'
   *
   * @param evaluations - Array of individual capability evaluations
   * @returns The most restrictive action from all evaluations
   */
  getOverallAction(evaluations: PolicyEvaluation[]): SkillPolicyAction {
    if (evaluations.length === 0) {
      return 'deny'
    }

    let hasRequireApproval = false

    for (const evaluation of evaluations) {
      if (evaluation.action === 'deny') {
        return 'deny'
      }
      if (evaluation.action === 'require_approval') {
        hasRequireApproval = true
      }
    }

    return hasRequireApproval ? 'require_approval' : 'allow'
  }

  /**
   * Check non-overridable system rules for a capability + scope combination.
   *
   * System rules are evaluated before any user-defined policy rules and produce
   * an immediate 'deny' if any requested scope matches a blocked scope.
   *
   * @param capability - The capability being requested
   * @param scope - The scope values to check against blocked lists
   * @returns A denial PolicyEvaluation if blocked, or null if no system rule matches
   */
  private checkSystemRules(capability: SkillCapability, scope: string[]): PolicyEvaluation | null {
    for (const rule of this.systemRules) {
      if (rule.capability !== capability) {
        continue
      }

      for (const reqScope of scope) {
        for (const blockedScope of rule.blockedScopes) {
          if (matchScope(reqScope, blockedScope, capability)) {
            return {
              action: 'deny',
              capability,
              requestedScope: scope,
              reason: `${rule.reason}: "${reqScope}" matches blocked scope "${blockedScope}"`,
            }
          }
        }
      }
    }

    return null
  }
}
