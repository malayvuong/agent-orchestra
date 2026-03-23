import type { AgentAssignment, AgentLens } from '../types/agent.js'
import { getDefaultModelForProvider } from '@malayvuong/agent-orchestra-shared'
import type { SkillLoader } from '../skills/loader.js'
import type { SkillSetLoader } from '../skills/skillset-loader.js'
import type { Superpower, ResolvedSuperpower } from './types.js'
import type { SuperpowerCatalog } from './catalog.js'

/** Logger interface consistent with the rest of the codebase */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

/** Overrides that can be applied when resolving a superpower */
export type SuperpowerOverrides = {
  lens?: AgentLens
  provider?: string
  model?: string
  brief?: string
  /** Override reviewer count (test convenience) */
  reviewerCount?: number
}

/**
 * Options object for constructing a SuperpowerResolver.
 * Accepts either full loader instances (for production use) or
 * simple ID lists (for testing / lightweight validation).
 */
export type SuperpowerResolverOptions = {
  skillLoader?: SkillLoader
  skillSetLoader?: SkillSetLoader
  loadedSkillIds?: string[]
  loadedSkillSetIds?: string[]
  logger?: Logger
}

/**
 * SuperpowerResolver takes a superpower ID, validates its skill references,
 * builds agent assignments from the agent preset, applies overrides, and
 * returns a fully resolved superpower ready for job creation.
 *
 * ARCHITECTURE (ADR-016): Superpowers integrate at the **job composition layer**.
 * This resolver produces job configuration (agents, skills, runtime config) that feeds
 * directly into orchestrator.createJob(). It never touches the skill execution path,
 * policy engine, sandbox, or provider layer. All execution remains in the existing
 * orchestrator → protocol runner → provider → normalizer pipeline.
 */
export class SuperpowerResolver {
  private readonly catalog: SuperpowerCatalog
  private readonly skillLoader?: SkillLoader
  private readonly skillSetLoader?: SkillSetLoader
  private readonly loadedSkillIds?: Set<string>
  private readonly loadedSkillSetIds?: Set<string>
  private readonly logger?: Logger

  /**
   * Construct a SuperpowerResolver.
   *
   * Supports two call signatures:
   *   1. `new SuperpowerResolver(catalog, skillLoader?, skillSetLoader?, logger?)` — full loader instances
   *   2. `new SuperpowerResolver(catalog, options)` — options object with loaders or ID lists
   */
  constructor(catalog: SuperpowerCatalog, options?: SuperpowerResolverOptions)
  constructor(
    catalog: SuperpowerCatalog,
    skillLoader?: SkillLoader | SuperpowerResolverOptions,
    skillSetLoader?: SkillSetLoader,
    logger?: Logger,
  )
  constructor(
    catalog: SuperpowerCatalog,
    skillLoaderOrOptions?: SkillLoader | SuperpowerResolverOptions,
    skillSetLoader?: SkillSetLoader,
    logger?: Logger,
  ) {
    this.catalog = catalog

    if (
      skillLoaderOrOptions &&
      typeof skillLoaderOrOptions === 'object' &&
      !isSkillLoader(skillLoaderOrOptions)
    ) {
      // Options-object form
      const opts = skillLoaderOrOptions as SuperpowerResolverOptions
      this.skillLoader = opts.skillLoader
      this.skillSetLoader = opts.skillSetLoader
      this.logger = opts.logger
      if (opts.loadedSkillIds) {
        this.loadedSkillIds = new Set(opts.loadedSkillIds)
      }
      if (opts.loadedSkillSetIds) {
        this.loadedSkillSetIds = new Set(opts.loadedSkillSetIds)
      }
    } else {
      // Positional-argument form
      this.skillLoader = skillLoaderOrOptions as SkillLoader | undefined
      this.skillSetLoader = skillSetLoader
      this.logger = logger
    }
  }

  /**
   * Resolve a superpower by ID into a fully validated ResolvedSuperpower.
   *
   * @param superpowerId - The ID of the superpower to resolve
   * @param overrides - Optional overrides for lens, provider, model, or brief
   * @throws Error if the superpower ID is not found in the catalog
   */
  resolve(superpowerId: string, overrides?: SuperpowerOverrides): ResolvedSuperpower {
    const superpower = this.catalog.get(superpowerId)
    if (!superpower) {
      throw new Error(`Superpower "${superpowerId}" not found in catalog`)
    }

    const warnings: string[] = []

    // --- Validate skill set references ---
    const resolvedSkillSetIds = this.validateSkillSetIds(superpower, warnings)

    // --- Validate skill references ---
    const resolvedSkillIds = this.validateSkillIds(superpower, warnings)

    // --- Build agent assignments from preset ---
    const agentAssignments = this.buildAgentAssignments(superpower, overrides, warnings)

    // --- Build runtime config patch ---
    const runtimeConfigPatch: { skillBudgetPercent?: number } = {}
    if (superpower.runtimeDefaults?.skillBudgetPercent !== undefined) {
      runtimeConfigPatch.skillBudgetPercent = superpower.runtimeDefaults.skillBudgetPercent
    }

    // --- Validate protocol ---
    const protocol = 'single_challenger' as const
    if (superpower.protocol && superpower.protocol !== 'single_challenger') {
      warnings.push(
        `Superpower "${superpowerId}" specifies protocol "${superpower.protocol}" ` +
          `but only "single_challenger" is supported — falling back to single_challenger`,
      )
    }

    return {
      superpower,
      resolvedSkillSetIds,
      resolvedSkillIds,
      protocol,
      runtimeConfigPatch,
      agentAssignments,
      warnings,
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate skillSetIds against loaded skill sets.
   * Missing skill sets produce a warning but do not cause failure.
   */
  private validateSkillSetIds(superpower: Superpower, warnings: string[]): string[] {
    const skillSetIds = superpower.skillSetIds ?? []
    if (skillSetIds.length === 0) {
      return []
    }

    // If explicit ID set was provided (options-object form), validate against it
    if (this.loadedSkillSetIds) {
      const resolved: string[] = []
      for (const ssId of skillSetIds) {
        if (this.loadedSkillSetIds.has(ssId)) {
          resolved.push(ssId)
        } else {
          warnings.push(
            `Superpower "${superpower.id}" references skill set "${ssId}" which is not found — skipping`,
          )
        }
      }
      return resolved
    }

    // If no skill set loader is available, we cannot validate — pass through with warning
    if (!this.skillSetLoader) {
      this.logger?.warn(
        `No SkillSetLoader provided — cannot validate skillSetIds for superpower "${superpower.id}"`,
      )
      return [...skillSetIds]
    }

    // The SkillSetLoader does not expose a "has" method, so we pass through
    // the IDs and let the caller validate at job-creation time.
    return [...skillSetIds]
  }

  /**
   * Validate skillIds against loaded skills.
   * Missing skills produce a warning but do not cause failure.
   */
  private validateSkillIds(superpower: Superpower, warnings: string[]): string[] {
    const skillIds = superpower.skillIds ?? []
    if (skillIds.length === 0) {
      return []
    }

    // If explicit ID set was provided (options-object form), validate against it
    if (this.loadedSkillIds) {
      const resolved: string[] = []
      for (const skillId of skillIds) {
        if (this.loadedSkillIds.has(skillId)) {
          resolved.push(skillId)
        } else {
          warnings.push(
            `Superpower "${superpower.id}" references skill "${skillId}" which is not loaded — skipping`,
          )
        }
      }
      return resolved
    }

    // If no skill loader is available, we cannot validate — pass through with warning
    if (!this.skillLoader) {
      this.logger?.warn(
        `No SkillLoader provided — cannot validate skillIds for superpower "${superpower.id}"`,
      )
      return [...skillIds]
    }

    const loadedSkills = this.skillLoader.getCache()
    const loadedIds = new Set(loadedSkills.map((s) => s.id))
    const resolved: string[] = []

    for (const skillId of skillIds) {
      if (loadedIds.has(skillId)) {
        resolved.push(skillId)
      } else {
        warnings.push(
          `Superpower "${superpower.id}" references skill "${skillId}" which is not loaded — skipping`,
        )
      }
    }

    return resolved
  }

  /**
   * Build AgentAssignment[] from the superpower's agentPreset.
   * Applies overrides for lens, provider, and model.
   */
  private buildAgentAssignments(
    superpower: Superpower,
    overrides: SuperpowerOverrides | undefined,
    warnings: string[],
  ): AgentAssignment[] {
    const assignments: AgentAssignment[] = []
    const preset = superpower.agentPreset

    // --- Architect assignment ---
    if (preset.architect?.enabled) {
      const architectProvider = overrides?.provider ?? preset.architect.provider ?? 'openai'
      const architectModel =
        overrides?.model ??
        (overrides?.provider
          ? getDefaultModelForProvider(architectProvider)
          : (preset.architect.model ?? getDefaultModelForProvider(architectProvider)))

      const architectAssignment: AgentAssignment = {
        id: `${superpower.id}-architect`,
        agentConfigId: `${superpower.id}-architect`,
        role: 'architect',
        connectionType: 'api',
        providerKey: architectProvider,
        modelOrCommand: architectModel,
        protocol: 'single_challenger',
        enabled: true,
        allowReferenceScan: true,
        canWriteCode: false,
      }

      assignments.push(architectAssignment)
    }

    // --- Reviewer assignment(s) ---
    const reviewerLens = overrides?.lens ?? preset.reviewer.lens
    const reviewerProvider = overrides?.provider ?? preset.reviewer.provider ?? 'openai'
    const reviewerModel =
      overrides?.model ??
      (overrides?.provider
        ? getDefaultModelForProvider(reviewerProvider)
        : (preset.reviewer.model ?? getDefaultModelForProvider(reviewerProvider)))
    const reviewerCount = overrides?.reviewerCount ?? preset.reviewer.count ?? 1

    if (reviewerCount > 1) {
      warnings.push(
        `Superpower "${superpower.id}" requests ${reviewerCount} reviewers ` +
          `but reviewer_wave is not implemented — using single reviewer`,
      )
      // reviewerCount clamped to 1 — will be used when reviewer_wave is implemented
    }

    const reviewerAssignment: AgentAssignment = {
      id: `${superpower.id}-reviewer`,
      agentConfigId: `${superpower.id}-reviewer`,
      role: 'reviewer',
      lens: reviewerLens,
      connectionType: 'api',
      providerKey: reviewerProvider,
      modelOrCommand: reviewerModel,
      protocol: 'single_challenger',
      enabled: true,
      allowReferenceScan: true,
      canWriteCode: false,
    }

    assignments.push(reviewerAssignment)

    return assignments
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Type guard to distinguish a SkillLoader instance from a plain options object.
 * SkillLoader has a `getCache` method; options objects do not.
 */
function isSkillLoader(obj: unknown): obj is SkillLoader {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'getCache' in obj &&
    typeof (obj as SkillLoader).getCache === 'function'
  )
}
