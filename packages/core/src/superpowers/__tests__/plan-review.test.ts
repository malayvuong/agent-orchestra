import { describe, it, expect } from 'vitest'
import { SuperpowerResolver } from '../resolver.js'
import { loadSuperpowerCatalog } from '../catalog.js'
import { BUILTIN_SUPERPOWERS } from '../builtin.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const PLAN_REVIEW_SKILL_IDS = [
  'sequencing-check',
  'dependency-check',
  'scope-discipline',
  'implementation-readiness',
  'risk-check',
]

// ---------------------------------------------------------------------------
// Superpower definition
// ---------------------------------------------------------------------------

describe('plan-review — superpower definition', () => {
  it('exists in the built-in superpowers list', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')
    expect(sp).toBeDefined()
  })

  it('has category "review"', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.category).toBe('review')
  })

  it('has maturity "safe"', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.maturity).toBe('safe')
  })

  it('does not require approval', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.requiresApproval).toBeFalsy()
  })

  it('uses single_challenger protocol', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.protocol).toBe('single_challenger')
  })

  it('does not reference a skillset (uses skillIds only)', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.skillSetIds).toBeUndefined()
  })

  it('references all 5 plan-review skill IDs', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    for (const skillId of PLAN_REVIEW_SKILL_IDS) {
      expect(sp.skillIds).toContain(skillId)
    }
  })

  it('has no capability expectations (prompt-only)', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.capabilityExpectation).toBeUndefined()
  })

  it('reviewer lens is implementation_readiness', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.agentPreset.reviewer.lens).toBe('implementation_readiness')
  })

  it('architect is enabled', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.agentPreset.architect?.enabled).toBe(true)
  })

  it('has skillBudgetPercent of 30', () => {
    const sp = BUILTIN_SUPERPOWERS.find((s) => s.id === 'plan-review')!
    expect(sp.runtimeDefaults?.skillBudgetPercent).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Superpower resolution
// ---------------------------------------------------------------------------

describe('plan-review — superpower resolution', () => {
  it('resolves without throwing', () => {
    const resolver = createResolver()
    expect(() => resolver.resolve('plan-review')).not.toThrow()
  })

  it('resolves with protocol "single_challenger"', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review')
    expect(result.protocol).toBe('single_challenger')
  })

  it('resolves with correct superpower reference', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review')
    expect(result.superpower.id).toBe('plan-review')
  })

  it('creates architect and reviewer agent assignments', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review')

    const roles = result.agentAssignments.map((a) => a.role)
    expect(roles).toContain('architect')
    expect(roles).toContain('reviewer')
  })

  it('reviewer assignment has lens implementation_readiness', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review')

    const reviewer = result.agentAssignments.find((a) => a.role === 'reviewer')
    expect(reviewer).toBeDefined()
    expect(reviewer!.lens).toBe('implementation_readiness')
  })

  it('agent assignments have unique IDs', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review')

    const ids = result.agentAssignments.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('agent assignment IDs are prefixed with "plan-review-"', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review')

    for (const a of result.agentAssignments) {
      expect(a.id).toMatch(/^plan-review-/)
    }
  })

  it('runtimeConfigPatch has skillBudgetPercent 30', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review')
    expect(result.runtimeConfigPatch.skillBudgetPercent).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Skill ID validation
// ---------------------------------------------------------------------------

describe('plan-review — skill validation', () => {
  it('resolves all skill IDs when loaded', () => {
    const resolver = createResolver({
      loadedSkillIds: PLAN_REVIEW_SKILL_IDS,
      loadedSkillSetIds: ['plan-review'],
    })
    const result = resolver.resolve('plan-review')

    for (const skillId of PLAN_REVIEW_SKILL_IDS) {
      expect(result.resolvedSkillIds).toContain(skillId)
    }
  })

  it('resolves skillset IDs as empty array when not configured', () => {
    const resolver = createResolver({
      loadedSkillIds: PLAN_REVIEW_SKILL_IDS,
      loadedSkillSetIds: [],
    })
    const result = resolver.resolve('plan-review')
    expect(result.resolvedSkillSetIds).toEqual([])
  })

  it('warns when skill IDs are not loaded', () => {
    const resolver = createResolver({ loadedSkillIds: [] })
    const result = resolver.resolve('plan-review')

    // Should have warnings for each missing skill
    expect(result.warnings.length).toBeGreaterThanOrEqual(PLAN_REVIEW_SKILL_IDS.length)
  })

  it('no warnings when all skills are loaded (skillset not needed)', () => {
    const resolver = createResolver({
      loadedSkillIds: PLAN_REVIEW_SKILL_IDS,
      loadedSkillSetIds: [],
    })
    const result = resolver.resolve('plan-review')

    const refWarnings = result.warnings.filter(
      (w) => w.includes('not found') || w.includes('not loaded'),
    )
    expect(refWarnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// CLI argument overrides
// ---------------------------------------------------------------------------

describe('plan-review — overrides', () => {
  it('applies lens override', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review', { lens: 'scope' })

    const reviewer = result.agentAssignments.find((a) => a.role === 'reviewer')
    expect(reviewer!.lens).toBe('scope')
  })

  it('applies provider override', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review', { provider: 'anthropic' })

    for (const a of result.agentAssignments) {
      expect(a.providerKey).toBe('anthropic')
    }
  })

  it('applies model override', () => {
    const resolver = createResolver()
    const result = resolver.resolve('plan-review', { model: 'claude-sonnet-4-6' })

    for (const a of result.agentAssignments) {
      expect(a.modelOrCommand).toBe('claude-sonnet-4-6')
    }
  })
})

// ---------------------------------------------------------------------------
// Catalog integration
// ---------------------------------------------------------------------------

describe('plan-review — catalog integration', () => {
  it('is available in the catalog', () => {
    const catalog = loadSuperpowerCatalog()
    expect(catalog.has('plan-review')).toBe(true)
  })

  it('appears in catalog.list()', () => {
    const catalog = loadSuperpowerCatalog()
    const ids = catalog.list().map((s) => s.id)
    expect(ids).toContain('plan-review')
  })

  it('catalog.get() returns plan-review definition', () => {
    const catalog = loadSuperpowerCatalog()
    const sp = catalog.get('plan-review')
    expect(sp).toBeDefined()
    expect(sp!.id).toBe('plan-review')
    expect(sp!.name).toBe('Plan Review')
  })
})

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe('plan-review — backward compatibility', () => {
  it('does not affect resolution of existing superpowers', () => {
    const resolver = createResolver()
    const existingIds = ['security-review', 'dependency-audit', 'test-generation', 'auto-fix-lint']

    for (const id of existingIds) {
      expect(() => resolver.resolve(id)).not.toThrow()
      const result = resolver.resolve(id)
      expect(result.superpower.id).toBe(id)
      expect(result.protocol).toBe('single_challenger')
    }
  })

  it('total built-in superpowers count is now 5', () => {
    expect(BUILTIN_SUPERPOWERS).toHaveLength(5)
  })

  it('existing superpower definitions are unchanged', () => {
    const securityReview = BUILTIN_SUPERPOWERS.find((s) => s.id === 'security-review')!
    expect(securityReview.category).toBe('review')
    expect(securityReview.agentPreset.reviewer.lens).toBe('security')

    const autoFixLint = BUILTIN_SUPERPOWERS.find((s) => s.id === 'auto-fix-lint')!
    expect(autoFixLint.category).toBe('fix')
    expect(autoFixLint.maturity).toBe('advanced')
    expect(autoFixLint.requiresApproval).toBe(true)
  })
})
