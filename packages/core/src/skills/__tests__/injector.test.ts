import { describe, it, expect, beforeEach } from 'vitest'
import { SkillInjector } from '../injector.js'
import type { TokenEstimator } from '../../interfaces/token-estimator.js'
import type { SkillDefinition, SkillMatchResult } from '../types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * A simple token estimator that counts whitespace-separated words.
 * This gives deterministic, human-readable token counts in tests.
 */
function makeWordCountEstimator(): TokenEstimator {
  return {
    estimate(text: string): number {
      if (text.trim() === '') return 0
      return text.trim().split(/\s+/).length
    },
  }
}

function makeSkill(overrides: Partial<SkillDefinition> & { id: string }): SkillDefinition {
  const { id } = overrides
  return {
    version: '1.0.0',
    name: overrides.name ?? id,
    description: `Skill ${id}`,
    skillType: 'prompt',
    source: { type: 'local', path: `/skills/${id}/SKILL.md` },
    promptContent: overrides.promptContent ?? `Content for ${id}`,
    promptSummary: overrides.promptSummary ?? `Summary for ${id}`,
    ...overrides,
  }
}

function makeMatchResult(skills: SkillDefinition[]): SkillMatchResult {
  const reason = new Map<string, string>()
  for (const skill of skills) {
    reason.set(skill.id, 'always-on')
  }
  return { matched: skills, reason }
}

// ---------------------------------------------------------------------------
// SkillInjector — full content injection
// ---------------------------------------------------------------------------

describe('SkillInjector — full content injection', () => {
  let injector: SkillInjector

  beforeEach(() => {
    injector = new SkillInjector(makeWordCountEstimator())
  })

  it('injects full content when budget is sufficient', () => {
    const skill = makeSkill({
      id: 'security-skill',
      name: 'Security Checklist',
      promptContent: 'Check for injection vulnerabilities.',
      promptSummary: 'Security summary.',
    })
    const matched = makeMatchResult([skill])

    // Budget = 100 words — full content ("## Skill: Security Checklist\n\nCheck for injection vulnerabilities." ~ 7 words)
    const result = injector.inject(matched, 100)

    expect(result.skillContext).toContain('## Skill: Security Checklist')
    expect(result.skillContext).toContain('Check for injection vulnerabilities.')
    expect(result.skillContext).not.toContain('(summary)')
    expect(result.injectedIds).toEqual(['security-skill'])
    expect(result.usedTokens).toBeGreaterThan(0)
  })

  it('uses the format "## Skill: {name}\\n\\n{promptContent}"', () => {
    const skill = makeSkill({
      id: 'skill-a',
      name: 'My Skill',
      promptContent: 'Do things carefully.',
    })
    const result = injector.inject(makeMatchResult([skill]), 1000)

    expect(result.skillContext).toBe('## Skill: My Skill\n\nDo things carefully.')
  })
})

// ---------------------------------------------------------------------------
// SkillInjector — summary injection (progressive disclosure)
// ---------------------------------------------------------------------------

describe('SkillInjector — summary injection (progressive disclosure)', () => {
  let injector: SkillInjector

  beforeEach(() => {
    injector = new SkillInjector(makeWordCountEstimator())
  })

  it('injects summary when full content does not fit but summary does', () => {
    // promptContent is long (>10 words), promptSummary is short (<10 words)
    const longContent = 'word '.repeat(20).trim() // 20 words
    const shortSummary = 'Short summary here.' // 3 words

    const skill = makeSkill({
      id: 'big-skill',
      name: 'Big Skill',
      promptContent: longContent,
      promptSummary: shortSummary,
    })
    const matched = makeMatchResult([skill])

    // Full content ~24 tokens, summary ~19 tokens.
    // Budget 22 — not enough for full content but enough for summary.
    const result = injector.inject(matched, 22)

    expect(result.skillContext).toContain('## Skill: Big Skill (summary)')
    expect(result.skillContext).toContain(shortSummary)
    expect(result.skillContext).not.toContain(longContent)
    expect(result.injectedIds).toEqual(['big-skill'])
  })

  it('includes progressive disclosure note in summary mode', () => {
    const longContent = 'word '.repeat(30).trim()
    const skill = makeSkill({
      id: 'verbose-skill',
      name: 'Verbose Skill',
      promptContent: longContent,
      promptSummary: 'Short.',
    })

    // Full content ~34 tokens, summary ~17 tokens. Budget 25 → full doesn't fit, summary does.
    const result = injector.inject(makeMatchResult([skill]), 25)

    expect(result.skillContext).toContain('[Full skill content available —')
    expect(result.skillContext).toContain('tokens — request if needed]')
  })

  it('progressive disclosure note includes the full token count', () => {
    const estimator = makeWordCountEstimator()
    injector = new SkillInjector(estimator)

    const skill = makeSkill({
      id: 'counted-skill',
      name: 'Counted Skill',
      promptContent: 'word '.repeat(30).trim(),
      promptSummary: 'Short.',
    })

    const fullContent = `## Skill: Counted Skill\n\n${'word '.repeat(30).trim()}`
    const expectedTokens = estimator.estimate(fullContent)

    // Full content ~34 tokens, summary ~17 tokens. Budget 25 → full doesn't fit, summary does.
    const result = injector.inject(makeMatchResult([skill]), 25)

    expect(result.skillContext).toContain(`${expectedTokens} tokens`)
  })
})

// ---------------------------------------------------------------------------
// SkillInjector — skill skipped when even summary exceeds budget
// ---------------------------------------------------------------------------

describe('SkillInjector — skill skipped when budget too small', () => {
  it('returns empty skillContext when even summary exceeds budget', () => {
    const injector = new SkillInjector(makeWordCountEstimator())

    const skill = makeSkill({
      id: 'large-skill',
      name: 'Large Skill',
      promptContent: 'word '.repeat(50).trim(),
      promptSummary: 'word '.repeat(20).trim(),
    })

    // Budget = 5 words — way too small even for summary
    const result = injector.inject(makeMatchResult([skill]), 5)

    expect(result.skillContext).toBe('')
    expect(result.injectedIds).toEqual([])
    expect(result.usedTokens).toBe(0)
  })

  it('skips skill silently and does not throw when budget is zero', () => {
    const injector = new SkillInjector(makeWordCountEstimator())

    const skill = makeSkill({ id: 'any-skill', promptContent: 'Some content.' })
    const result = injector.inject(makeMatchResult([skill]), 0)

    expect(result.skillContext).toBe('')
    expect(result.injectedIds).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// SkillInjector — multiple skills injected in order until budget exhausted
// ---------------------------------------------------------------------------

describe('SkillInjector — multiple skills with budget exhaustion', () => {
  it('injects multiple skills in order until budget is exhausted', () => {
    const estimator = makeWordCountEstimator()
    const injector = new SkillInjector(estimator)

    // skill-a: short (fits fully)
    const skillA = makeSkill({
      id: 'skill-a',
      name: 'Skill A',
      promptContent: 'Short content A.',
      promptSummary: 'Summary A.',
    })
    // skill-b: medium (fits fully)
    const skillB = makeSkill({
      id: 'skill-b',
      name: 'Skill B',
      promptContent: 'Short content B.',
      promptSummary: 'Summary B.',
    })
    // skill-c: very long (won't fit at all)
    const skillC = makeSkill({
      id: 'skill-c',
      name: 'Skill C',
      promptContent: 'word '.repeat(200).trim(),
      promptSummary: 'word '.repeat(100).trim(),
    })

    const matched = makeMatchResult([skillA, skillB, skillC])

    // Budget: 30 words — enough for skill-a and skill-b full, but not skill-c
    const result = injector.inject(matched, 30)

    expect(result.injectedIds).toContain('skill-a')
    expect(result.injectedIds).toContain('skill-b')
    expect(result.injectedIds).not.toContain('skill-c')
    expect(result.skillContext).toContain('## Skill: Skill A')
    expect(result.skillContext).toContain('## Skill: Skill B')
    expect(result.skillContext).not.toContain('## Skill: Skill C')
  })

  it('separates multiple injected skills with double newline', () => {
    const injector = new SkillInjector(makeWordCountEstimator())

    const skillA = makeSkill({ id: 'skill-a', name: 'Skill A', promptContent: 'Content A.' })
    const skillB = makeSkill({ id: 'skill-b', name: 'Skill B', promptContent: 'Content B.' })

    const result = injector.inject(makeMatchResult([skillA, skillB]), 1000)

    // Two blocks separated by '\n\n'
    const blocks = result.skillContext.split('\n\n## Skill:')
    expect(blocks.length).toBe(2)
  })

  it('usedTokens sums across all injected skills', () => {
    const estimator = makeWordCountEstimator()
    const injector = new SkillInjector(estimator)

    const skillA = makeSkill({ id: 'a', name: 'A', promptContent: 'Content A.' })
    const skillB = makeSkill({ id: 'b', name: 'B', promptContent: 'Content B.' })

    const result = injector.inject(makeMatchResult([skillA, skillB]), 1000)

    const expectedA = estimator.estimate('## Skill: A\n\nContent A.')
    const expectedB = estimator.estimate('## Skill: B\n\nContent B.')
    expect(result.usedTokens).toBe(expectedA + expectedB)
  })
})

// ---------------------------------------------------------------------------
// SkillInjector — empty matched skills
// ---------------------------------------------------------------------------

describe('SkillInjector — empty matched skills', () => {
  it('returns empty skillContext for empty matched result', () => {
    const injector = new SkillInjector(makeWordCountEstimator())

    const emptyMatch: SkillMatchResult = { matched: [], reason: new Map() }
    const result = injector.inject(emptyMatch, 1000)

    expect(result.skillContext).toBe('')
    expect(result.injectedIds).toEqual([])
    expect(result.usedTokens).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SkillInjector — barrel export
// ---------------------------------------------------------------------------

describe('SkillInjector barrel export', () => {
  it('is exported from skills/index.ts', async () => {
    const module = await import('../index.js')
    expect(module.SkillInjector).toBeDefined()
    expect(typeof module.SkillInjector).toBe('function')
  })
})
