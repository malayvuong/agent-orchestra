import { describe, it, expect } from 'vitest'
import { SuperpowerResolver } from '../resolver.js'
import { loadSuperpowerCatalog } from '../catalog.js'
import type { AgentLens } from '../../types/agent.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal SuperpowerResolver with a real catalog and
 * optional mock skill/skillset ID lists for validation.
 */
function createResolver(opts?: {
  loadedSkillIds?: string[]
  loadedSkillSetIds?: string[]
}): SuperpowerResolver {
  const catalog = loadSuperpowerCatalog()
  return new SuperpowerResolver(catalog, {
    loadedSkillIds: opts?.loadedSkillIds ?? [],
    loadedSkillSetIds: opts?.loadedSkillSetIds ?? [],
  })
}

// ---------------------------------------------------------------------------
// Basic resolution — security-review
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — basic resolution', () => {
  it('resolves security-review with protocol "single_challenger"', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    expect(result.protocol).toBe('single_challenger')
  })

  it('resolves security-review with the correct superpower reference', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    expect(result.superpower).toBeDefined()
    expect(result.superpower.id).toBe('security-review')
  })

  it('resolves security-review with reviewer lens=security in agent assignments', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    const reviewerAssignment = result.agentAssignments.find((a) => a.role === 'reviewer')
    expect(reviewerAssignment).toBeDefined()
    expect(reviewerAssignment!.lens).toBe('security')
  })

  it('resolve without overrides uses superpower defaults', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    // Should use the default lens from the superpower definition
    const reviewerAssignment = result.agentAssignments.find((a) => a.role === 'reviewer')
    expect(reviewerAssignment).toBeDefined()
    expect(reviewerAssignment!.lens).toBe(result.superpower.agentPreset.reviewer.lens)
  })
})

// ---------------------------------------------------------------------------
// Agent assignments
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — agent assignments', () => {
  it('creates reviewer agent assignment', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    const reviewers = result.agentAssignments.filter((a) => a.role === 'reviewer')
    expect(reviewers.length).toBeGreaterThanOrEqual(1)
  })

  it('creates architect agent assignment when superpower enables it', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    // The security-review superpower may or may not enable architect.
    // Check based on the superpower definition:
    if (result.superpower.agentPreset.architect?.enabled) {
      const architects = result.agentAssignments.filter((a) => a.role === 'architect')
      expect(architects.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('creates architect + reviewer agent assignments for superpowers with architect enabled', () => {
    // Load catalog and find any superpower with architect enabled
    const catalog = loadSuperpowerCatalog()
    const allSuperpowers = catalog.list()

    // Create a resolver and resolve all superpowers that have architect enabled
    const resolver = createResolver()

    for (const sp of allSuperpowers) {
      if (sp.agentPreset.architect?.enabled) {
        const result = resolver.resolve(sp.id)
        const roles = result.agentAssignments.map((a) => a.role)
        expect(roles).toContain('architect')
        expect(roles).toContain('reviewer')
      }
    }
  })

  it('each agent assignment has a unique id', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    const ids = result.agentAssignments.map((a) => a.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('agent assignments have required fields (id, role, providerKey, modelOrCommand)', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    for (const assignment of result.agentAssignments) {
      expect(assignment.id).toBeTruthy()
      expect(assignment.role).toBeTruthy()
      expect(assignment.providerKey).toBeTruthy()
      // modelOrCommand may be empty when provider is 'auto' — resolved later by resolveProviderPlans
      expect(typeof assignment.modelOrCommand).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// Skill resolution and warnings
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — skill resolution', () => {
  it('resolvedSkillIds contains the skills from the superpower definition', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('security-review')!
    const expectedSkillIds = sp.skillIds ?? []

    const resolver = createResolver({ loadedSkillIds: expectedSkillIds })
    const result = resolver.resolve('security-review')

    for (const skillId of expectedSkillIds) {
      expect(result.resolvedSkillIds).toContain(skillId)
    }
  })

  it('warns when referenced skillSetId is not found in loaded skill sets', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('security-review')!
    const referencedSkillSetIds = sp.skillSetIds ?? []

    if (referencedSkillSetIds.length > 0) {
      // Resolve with empty loadedSkillSetIds — all references will be missing
      const resolver = createResolver({ loadedSkillSetIds: [] })
      const result = resolver.resolve('security-review')

      // Should produce warnings about missing skill set references
      expect(result.warnings.length).toBeGreaterThan(0)
      for (const ssId of referencedSkillSetIds) {
        expect(result.warnings.some((w) => w.includes(ssId))).toBe(true)
      }
    }
  })

  it('warns when referenced skillId is not found in loaded skills', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('security-review')!
    const referencedSkillIds = sp.skillIds ?? []

    if (referencedSkillIds.length > 0) {
      // Resolve with empty loadedSkillIds — all references will be missing
      const resolver = createResolver({ loadedSkillIds: [] })
      const result = resolver.resolve('security-review')

      // Should produce warnings about missing skill references
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  })

  it('no warnings when all referenced skill IDs are loaded', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('security-review')!
    const skillIds = sp.skillIds ?? []
    const skillSetIds = sp.skillSetIds ?? []

    const resolver = createResolver({
      loadedSkillIds: skillIds,
      loadedSkillSetIds: skillSetIds,
    })
    const result = resolver.resolve('security-review')

    // No warnings about missing references
    const refWarnings = result.warnings.filter(
      (w) => w.includes('not found') || w.includes('missing'),
    )
    expect(refWarnings).toHaveLength(0)
  })

  it('resolvedSkillSetIds contains the skill set IDs from the superpower', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('security-review')!
    const expectedSkillSetIds = sp.skillSetIds ?? []

    const resolver = createResolver({ loadedSkillSetIds: expectedSkillSetIds })
    const result = resolver.resolve('security-review')

    for (const ssId of expectedSkillSetIds) {
      expect(result.resolvedSkillSetIds).toContain(ssId)
    }
  })
})

// ---------------------------------------------------------------------------
// Reviewer count warning
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — reviewer_wave not implemented', () => {
  it('warns when reviewer count > 1 (reviewer_wave not implemented)', () => {
    const catalog = loadSuperpowerCatalog()
    const allSuperpowers = catalog.list()

    // Find or construct a superpower with reviewer count > 1
    const spWithMultiReviewers = allSuperpowers.find(
      (sp) => sp.agentPreset.reviewer.count !== undefined && sp.agentPreset.reviewer.count > 1,
    )

    if (spWithMultiReviewers) {
      const resolver = createResolver()
      const result = resolver.resolve(spWithMultiReviewers.id)
      expect(result.warnings.some((w) => w.includes('reviewer_wave') || w.includes('count'))).toBe(
        true,
      )
    } else {
      // If no built-in has count > 1, we verify the resolver handles it via overrides
      // Apply an override that sets count > 1
      const resolver = createResolver()
      const result = resolver.resolve('security-review', {
        reviewerCount: 3,
      })
      expect(result.warnings.some((w) => w.includes('reviewer_wave') || w.includes('count'))).toBe(
        true,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// CLI argument overrides
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — overrides', () => {
  it('applies lens override from CLI args', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review', { lens: 'performance' as AgentLens })

    const reviewerAssignment = result.agentAssignments.find((a) => a.role === 'reviewer')
    expect(reviewerAssignment).toBeDefined()
    expect(reviewerAssignment!.lens).toBe('performance')
  })

  it('applies provider override from CLI args', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review', { provider: 'anthropic' })

    // All assignments should use the overridden provider
    for (const assignment of result.agentAssignments) {
      expect(assignment.providerKey).toBe('anthropic')
    }
  })

  it('uses the overridden provider default model when provider changes without a model override', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review', { provider: 'anthropic' })

    for (const assignment of result.agentAssignments) {
      expect(assignment.providerKey).toBe('anthropic')
      expect(assignment.modelOrCommand).toBe('claude-sonnet-4-6')
    }
  })

  it('applies model override from CLI args', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review', { model: 'claude-sonnet-4-6' })

    // All assignments should use the overridden model
    for (const assignment of result.agentAssignments) {
      expect(assignment.modelOrCommand).toBe('claude-sonnet-4-6')
    }
  })

  it('applies both provider and model overrides together', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })

    for (const assignment of result.agentAssignments) {
      expect(assignment.providerKey).toBe('anthropic')
      expect(assignment.modelOrCommand).toBe('claude-sonnet-4-6')
    }
  })
})

// ---------------------------------------------------------------------------
// Protocol enforcement
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — protocol enforcement', () => {
  it('protocol is always "single_challenger"', () => {
    const resolver = createResolver()

    for (const sp of loadSuperpowerCatalog().list()) {
      const result = resolver.resolve(sp.id)
      expect(result.protocol).toBe('single_challenger')
    }
  })

  it('protocol is "single_challenger" even if superpower specifies something else', () => {
    // Even if the underlying superpower.protocol were changed, resolved should always be single_challenger
    const resolver = createResolver()
    const result = resolver.resolve('security-review')
    expect(result.protocol).toBe('single_challenger')
  })
})

// ---------------------------------------------------------------------------
// runtimeConfigPatch
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — runtimeConfigPatch', () => {
  it('runtimeConfigPatch includes skillBudgetPercent from runtimeDefaults', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('security-review')!

    const resolver = createResolver()
    const result = resolver.resolve('security-review')

    if (sp.runtimeDefaults?.skillBudgetPercent !== undefined) {
      expect(result.runtimeConfigPatch.skillBudgetPercent).toBe(
        sp.runtimeDefaults.skillBudgetPercent,
      )
    } else {
      // If no runtimeDefaults, the patch may have an undefined or default value
      expect(result.runtimeConfigPatch).toBeDefined()
    }
  })

  it('runtimeConfigPatch is always an object', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')
    expect(typeof result.runtimeConfigPatch).toBe('object')
    expect(result.runtimeConfigPatch).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Error handling — unknown superpower ID
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — error handling', () => {
  it('throws when superpower ID is not found in catalog', () => {
    const resolver = createResolver()
    expect(() => resolver.resolve('nonexistent-superpower')).toThrow()
  })

  it('throw message mentions the unknown superpower ID', () => {
    const resolver = createResolver()
    expect(() => resolver.resolve('unknown-id')).toThrow(/unknown-id/)
  })

  it('throws for empty string ID', () => {
    const resolver = createResolver()
    expect(() => resolver.resolve('')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Resolve all built-in superpowers (integration-level)
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — all built-ins', () => {
  const BUILT_IN_IDS = [
    'security-review',
    'dependency-audit',
    'test-generation',
    'auto-fix-lint',
    'plan-review',
  ]

  it('resolves each built-in superpower without throwing', () => {
    const resolver = createResolver()
    for (const id of BUILT_IN_IDS) {
      expect(() => resolver.resolve(id)).not.toThrow()
    }
  })

  it('each resolved superpower has the correct structure', () => {
    const resolver = createResolver()
    for (const id of BUILT_IN_IDS) {
      const result = resolver.resolve(id)

      expect(result.superpower).toBeDefined()
      expect(result.superpower.id).toBe(id)
      expect(result.protocol).toBe('single_challenger')
      expect(Array.isArray(result.resolvedSkillSetIds)).toBe(true)
      expect(Array.isArray(result.resolvedSkillIds)).toBe(true)
      expect(Array.isArray(result.agentAssignments)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
      expect(typeof result.runtimeConfigPatch).toBe('object')
    }
  })

  it('each resolved superpower has at least one agent assignment', () => {
    const resolver = createResolver()
    for (const id of BUILT_IN_IDS) {
      const result = resolver.resolve(id)
      expect(result.agentAssignments.length).toBeGreaterThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Warnings array
// ---------------------------------------------------------------------------

describe('SuperpowerResolver.resolve() — warnings', () => {
  it('warnings is always an array', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('warnings are strings', () => {
    const resolver = createResolver()
    const result = resolver.resolve('security-review')
    for (const w of result.warnings) {
      expect(typeof w).toBe('string')
    }
  })
})
