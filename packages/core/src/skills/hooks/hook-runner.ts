/**
 * SkillHookRunner — executes plugin-type skills at protocol lifecycle points.
 *
 * Phase F — Task 4.2: Integrates plugin skills into the protocol pipeline.
 *
 * Hooks run sequentially in skill priority order. Each hook:
 * 1. Has its policy evaluated before execution
 * 2. Runs in a sandbox with hook context as stdin JSON + env vars
 * 3. Produces artifacts collected from sandbox output
 * 4. Fails gracefully — errors are logged but do not crash the pipeline
 */

import type { SkillDefinition, SkillMatchResult } from '../types.js'
import type { SkillArtifact } from '../executor/types.js'
import type { LifecyclePoint, HookContext, HookResult } from './types.js'

// ---------------------------------------------------------------------------
// Dependency Interfaces (avoid tight coupling to concrete implementations)
// ---------------------------------------------------------------------------

/**
 * Minimal sandbox runner interface for hook execution.
 * The concrete SandboxRunner (Task 4.1) implements this.
 */
export interface HookSandboxRunner {
  run(
    script: string,
    args: string[],
    workspacePath: string,
    options?: {
      stdin?: string
      env?: Record<string, string>
    },
  ): Promise<{
    exitCode: number
    stdout: string
    stderr: string
    artifacts: SkillArtifact[]
    durationMs: number
    killed: boolean
    killReason?: string
  }>
}

/**
 * Minimal skill matcher interface — filters skills by lifecycle point.
 */
export interface HookSkillMatcher {
  match(
    skills: SkillDefinition[],
    agent: { id: string; role: 'architect' | 'reviewer' | 'builder'; lens?: string },
    context: { jobBrief: string; primaryTargets?: string[]; lifecyclePoint?: string },
  ): SkillMatchResult
}

/**
 * Minimal policy engine interface — evaluates whether a skill is allowed to run.
 */
export interface HookPolicyEngine {
  evaluateInvocation(
    capabilities: Array<{ capability: string; scope: string[] }>,
    policy: {
      defaultAction: 'deny'
      rules: unknown[]
      maxExecutionMs: number
      networkAllowed: boolean
    },
  ): Array<{ action: string; reason: string }>
  getOverallAction(evaluations: Array<{ action: string }>): string
}

/** Logger interface for hook execution reporting */
export interface HookLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

// ---------------------------------------------------------------------------
// SkillHookRunner
// ---------------------------------------------------------------------------

/**
 * Runs matching plugin hooks at protocol lifecycle points.
 *
 * Design principles:
 * - Sequential execution in priority order (deterministic)
 * - Policy evaluation before each hook (deny-by-default)
 * - Graceful degradation on hook failure (log + continue)
 * - All hook context passed via stdin JSON + environment variables
 */
export class SkillHookRunner {
  /** All plugin-type skills available for hook matching */
  private pluginSkills: SkillDefinition[] = []

  constructor(
    private sandboxRunner: HookSandboxRunner,
    private skillMatcher: HookSkillMatcher,
    private policyEngine: HookPolicyEngine,
    private logger: HookLogger,
  ) {}

  /**
   * Register the available plugin skills for lifecycle hook matching.
   *
   * @param skills - All loaded skills (will be filtered to plugin type with lifecycle triggers)
   */
  setPluginSkills(skills: SkillDefinition[]): void {
    this.pluginSkills = skills.filter(
      (s) => s.skillType === 'plugin' && s.triggers?.lifecycle && s.triggers.lifecycle.length > 0,
    )
  }

  /**
   * Run all matching plugin hooks for a lifecycle point.
   *
   * Flow:
   * 1. Match plugin skills that have this lifecycle point in their triggers
   * 2. For each matched skill (sequentially, in priority order):
   *    a. Evaluate policy — skip if denied
   *    b. Run in sandbox with hook context as stdin JSON + env vars
   *    c. Collect artifacts from sandbox result
   *    d. On failure: log error, continue to next hook
   * 3. Return array of HookResults
   *
   * @param lifecyclePoint - The lifecycle point to run hooks for
   * @param context - The hook execution context
   * @returns Array of results from each executed hook
   */
  async runHooks(lifecyclePoint: LifecyclePoint, context: HookContext): Promise<HookResult[]> {
    // Step 1: Match plugin skills for this lifecycle point
    const matchResult = this.skillMatcher.match(
      this.pluginSkills,
      { id: context.agentId, role: 'builder' },
      { jobBrief: '', lifecyclePoint },
    )

    if (matchResult.matched.length === 0) {
      return []
    }

    this.logger.info(`[hooks] ${lifecyclePoint}: ${matchResult.matched.length} hook(s) matched`)

    const results: HookResult[] = []

    // Step 2: Execute each matched hook sequentially
    for (const skill of matchResult.matched) {
      const result = await this.executeHook(skill, lifecyclePoint, context)
      results.push(result)
    }

    return results
  }

  /**
   * Execute a single plugin hook in a sandbox.
   *
   * @param skill - The plugin skill to execute
   * @param lifecyclePoint - Current lifecycle point
   * @param context - Hook execution context
   * @returns The hook execution result
   */
  private async executeHook(
    skill: SkillDefinition,
    lifecyclePoint: LifecyclePoint,
    context: HookContext,
  ): Promise<HookResult> {
    // Step 2a: Evaluate policy
    const policyAllowed = this.evaluatePolicy(skill)

    if (!policyAllowed) {
      this.logger.warn(`[hooks] ${lifecyclePoint}: skill "${skill.id}" denied by policy — skipping`)
      return {
        skillId: skill.id,
        success: false,
        artifacts: [],
        durationMs: 0,
        error: 'Denied by policy',
      }
    }

    // Step 2b: Build environment variables per hook script contract
    const env: Record<string, string> = {
      JOB_ID: context.jobId,
      ROUND_INDEX: String(context.roundIndex),
      AGENT_ID: context.agentId,
      LIFECYCLE_POINT: lifecyclePoint,
    }

    // Build stdin JSON payload with available context data
    const stdinPayload: Record<string, unknown> = {
      jobId: context.jobId,
      roundIndex: context.roundIndex,
      agentId: context.agentId,
      lifecyclePoint,
    }

    if (context.roundOutput !== undefined) {
      stdinPayload.roundOutput = context.roundOutput
    }

    if (context.synthesisOutput !== undefined) {
      stdinPayload.synthesisOutput = context.synthesisOutput
    }

    const stdinJson = JSON.stringify(stdinPayload)

    // Step 2c: Run in sandbox
    try {
      const scriptPath = this.resolveScriptPath(skill)

      const sandboxResult = await this.sandboxRunner.run(scriptPath, [], context.workspacePath, {
        stdin: stdinJson,
        env,
      })

      if (sandboxResult.exitCode !== 0) {
        this.logger.warn(
          `[hooks] ${lifecyclePoint}: skill "${skill.id}" exited with code ${sandboxResult.exitCode}: ${sandboxResult.stderr}`,
        )
        return {
          skillId: skill.id,
          success: false,
          artifacts: sandboxResult.artifacts,
          durationMs: sandboxResult.durationMs,
          error: sandboxResult.killed
            ? `Killed: ${sandboxResult.killReason}`
            : `Exit code ${sandboxResult.exitCode}: ${sandboxResult.stderr.slice(0, 500)}`,
        }
      }

      this.logger.info(
        `[hooks] ${lifecyclePoint}: skill "${skill.id}" completed in ${sandboxResult.durationMs}ms, ${sandboxResult.artifacts.length} artifact(s)`,
      )

      return {
        skillId: skill.id,
        success: true,
        artifacts: sandboxResult.artifacts,
        durationMs: sandboxResult.durationMs,
      }
    } catch (err) {
      // Step 2d: Graceful degradation — log and continue
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.logger.error(
        `[hooks] ${lifecyclePoint}: skill "${skill.id}" threw an exception: ${errorMsg}`,
      )

      return {
        skillId: skill.id,
        success: false,
        artifacts: [],
        durationMs: 0,
        error: errorMsg,
      }
    }
  }

  /**
   * Evaluate whether a plugin skill is allowed to run based on policy.
   *
   * Uses the policy engine to check the skill's required capabilities.
   * If the overall action is 'deny', the hook is skipped.
   *
   * @param skill - The plugin skill to check
   * @returns true if the skill is allowed (allow or require_approval), false if denied
   */
  private evaluatePolicy(skill: SkillDefinition): boolean {
    // Plugin skills require proc.spawn at minimum
    const capabilities = [{ capability: 'proc.spawn', scope: [skill.id] }]

    const defaultPolicy = {
      defaultAction: 'deny' as const,
      rules: [],
      maxExecutionMs: 30_000,
      networkAllowed: false,
    }

    const evaluations = this.policyEngine.evaluateInvocation(capabilities, defaultPolicy)
    const overallAction = this.policyEngine.getOverallAction(evaluations)

    return overallAction !== 'deny'
  }

  /**
   * Resolve the executable script path for a plugin skill.
   *
   * For local sources, uses the source path. For other sources,
   * constructs the path from the skill ID convention.
   *
   * @param skill - The plugin skill definition
   * @returns The path to the executable script
   */
  private resolveScriptPath(skill: SkillDefinition): string {
    if (skill.source.type === 'local') {
      return skill.source.path
    }

    // For registry/git sources, the script should be in the installed skill directory
    return skill.id
  }
}
