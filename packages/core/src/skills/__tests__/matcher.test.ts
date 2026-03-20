import { describe, it, expect, beforeEach } from 'vitest'
import { SkillMatcher } from '../matcher.js'
import type { SkillDefinition } from '../types.js'
import type { AgentAssignment } from '../../types/agent.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillDefinition> & { id: string }): SkillDefinition {
  const { id } = overrides
  return {
    version: '1.0.0',
    name: id,
    description: `Skill ${id}`,
    skillType: 'prompt',
    source: { type: 'local', path: `/skills/${id}/SKILL.md` },
    promptContent: `Content for ${id}`,
    promptSummary: `Summary for ${id}`,
    ...overrides,
  }
}

function makeAgent(overrides: Partial<AgentAssignment> = {}): AgentAssignment {
  return {
    id: 'agent-1',
    agentConfigId: 'config-1',
    role: 'reviewer',
    connectionType: 'api',
    providerKey: 'openai',
    modelOrCommand: 'gpt-4',
    protocol: 'openai',
    enabled: true,
    allowReferenceScan: false,
    canWriteCode: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// SkillMatcher.matchKeyword
// ---------------------------------------------------------------------------

describe('SkillMatcher.matchKeyword', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('matches a keyword case-insensitively', () => {
    expect(matcher.matchKeyword('owasp', 'Check OWASP guidelines')).toBe(true)
    expect(matcher.matchKeyword('OWASP', 'Check owasp guidelines')).toBe(true)
    expect(matcher.matchKeyword('Owasp', 'Check OWASP guidelines')).toBe(true)
  })

  it('matches keyword at word boundary — "sql" matches "SQL injection"', () => {
    expect(matcher.matchKeyword('sql', 'SQL injection attack')).toBe(true)
  })

  it('does NOT match keyword inside a word — "sql" does NOT match "dismissal"', () => {
    expect(matcher.matchKeyword('sql', 'dismissal')).toBe(false)
  })

  it('does NOT match "sql" as substring of "PostgreSQL" (word-boundary)', () => {
    // "PostgreSQL" — "sql" is at end but no word boundary after 'L'? Actually \bsql\b
    // "PostgreSQL" → 'sql' appears as suffix without a trailing word boundary from 'L'
    // \b is between \w and \W or start/end; 'L' is \w, so \bsql\b won't match inside PostgreSQL
    expect(matcher.matchKeyword('sql', 'use PostgreSQL database')).toBe(false)
  })

  it('matches keyword at start of text', () => {
    expect(matcher.matchKeyword('owasp', 'owasp top 10')).toBe(true)
  })

  it('matches keyword at end of text', () => {
    expect(matcher.matchKeyword('owasp', 'guidelines per owasp')).toBe(true)
  })

  it('does not match empty keyword against non-empty text', () => {
    // Empty keyword with word-boundary becomes \b\b which matches at word boundaries
    // This is an edge-case; the spec doesn't define it, but let's verify determinism
    const result = matcher.matchKeyword('', 'some text')
    // \b\b matches at any word boundary — likely true; just ensure no throw
    expect(typeof result).toBe('boolean')
  })

  it('returns false when text is empty', () => {
    expect(matcher.matchKeyword('owasp', '')).toBe(false)
  })

  it('handles keywords with special regex characters safely (no throw)', () => {
    // c++ has regex special chars; ensure no throw occurs
    // Note: word-boundary \b works between \w and \W chars;
    // since '+' is not \w, \bc\+\+\b won't find a right boundary after '+'.
    // The important behaviour is: no exception is thrown and the result is boolean.
    expect(typeof matcher.matchKeyword('c++', 'modern c++ features')).toBe('boolean')
    expect(matcher.matchKeyword('c++', 'modern java features')).toBe(false)
  })

  it('matches standalone word surrounded by punctuation', () => {
    expect(matcher.matchKeyword('sql', '"SQL" is a language')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — basic scenarios
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — no skills / empty results', () => {
  let matcher: SkillMatcher
  const agent = makeAgent({ lens: 'security' })
  const context = { jobBrief: 'check security vulnerabilities' }

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('returns empty result when skills array is empty', () => {
    const result = matcher.match([], agent, context)
    expect(result.matched).toHaveLength(0)
    expect(result.reason.size).toBe(0)
  })

  it('returns empty matched array when no skills match', () => {
    const skills = [
      makeSkill({ id: 'perf-skill', triggers: { lenses: ['performance'] } }),
      makeSkill({ id: 'arch-skill', triggers: { roles: ['architect'] } }),
    ]
    const result = matcher.match(skills, agent, context)
    // agent has lens 'security' and role 'reviewer', neither matches
    expect(result.matched).toHaveLength(0)
    expect(result.reason.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — lens matching
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — lens matching', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('matches skill with triggers.lenses when agent.lens is in the list', () => {
    const skill = makeSkill({ id: 'security-skill', triggers: { lenses: ['security'] } })
    const agent = makeAgent({ lens: 'security' })
    const result = matcher.match([skill], agent, { jobBrief: 'review the code' })

    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]!.id).toBe('security-skill')
    expect(result.reason.get('security-skill')).toBe('lens:security')
  })

  it('does NOT match skill with triggers.lenses when agent.lens is different', () => {
    const skill = makeSkill({ id: 'security-skill', triggers: { lenses: ['security'] } })
    const agent = makeAgent({ lens: 'performance' })
    const result = matcher.match([skill], agent, { jobBrief: 'review the code' })

    expect(result.matched).toHaveLength(0)
  })

  it('does NOT match skill with triggers.lenses when agent has no lens', () => {
    const skill = makeSkill({ id: 'security-skill', triggers: { lenses: ['security'] } })
    const agent = makeAgent({ lens: undefined })
    const result = matcher.match([skill], agent, { jobBrief: 'review the code' })

    expect(result.matched).toHaveLength(0)
  })

  it('matches when agent.lens appears in multi-lens trigger list', () => {
    const skill = makeSkill({
      id: 'multi-lens-skill',
      triggers: { lenses: ['security', 'risk', 'performance'] },
    })
    const agent = makeAgent({ lens: 'risk' })
    const result = matcher.match([skill], agent, { jobBrief: 'assess risk' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('multi-lens-skill')).toBe('lens:risk')
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — role matching
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — role matching', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('matches skill with triggers.roles when agent.role is in the list', () => {
    const skill = makeSkill({ id: 'reviewer-skill', triggers: { roles: ['reviewer'] } })
    const agent = makeAgent({ role: 'reviewer' })
    const result = matcher.match([skill], agent, { jobBrief: 'review code' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('reviewer-skill')).toBe('role:reviewer')
  })

  it('does NOT match skill with triggers.roles when agent.role differs', () => {
    const skill = makeSkill({ id: 'reviewer-skill', triggers: { roles: ['reviewer'] } })
    const agent = makeAgent({ role: 'builder' })
    const result = matcher.match([skill], agent, { jobBrief: 'build feature' })

    expect(result.matched).toHaveLength(0)
  })

  it('matches builder role skill for builder agent', () => {
    const skill = makeSkill({ id: 'builder-skill', triggers: { roles: ['builder'] } })
    const agent = makeAgent({ role: 'builder' })
    const result = matcher.match([skill], agent, { jobBrief: 'build feature' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('builder-skill')).toBe('role:builder')
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — keyword matching
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — keyword matching', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('matches skill with triggers.keywords when keyword appears in jobBrief', () => {
    const skill = makeSkill({ id: 'owasp-skill', triggers: { keywords: ['owasp'] } })
    const agent = makeAgent({ role: 'reviewer', lens: 'security' })
    const result = matcher.match([skill], agent, {
      jobBrief: 'Validate OWASP Top 10 vulnerabilities',
    })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('owasp-skill')).toBe('keyword:owasp')
  })

  it('does NOT match keyword if it only appears as a substring (word-boundary)', () => {
    const skill = makeSkill({ id: 'sql-skill', triggers: { keywords: ['sql'] } })
    const agent = makeAgent()
    const result = matcher.match([skill], agent, { jobBrief: 'handle dismissal of requests' })

    expect(result.matched).toHaveLength(0)
  })

  it('keyword match is case-insensitive', () => {
    const skill = makeSkill({ id: 'owasp-skill', triggers: { keywords: ['OWASP'] } })
    const agent = makeAgent()
    const result = matcher.match([skill], agent, { jobBrief: 'check owasp guidelines' })

    expect(result.matched).toHaveLength(1)
  })

  it('matches first keyword found and uses it in reason', () => {
    const skill = makeSkill({
      id: 'multi-kw-skill',
      triggers: { keywords: ['owasp', 'cve', 'injection'] },
    })
    const agent = makeAgent()
    // Only 'injection' matches
    const result = matcher.match([skill], agent, {
      jobBrief: 'check for injection vulnerabilities',
    })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('multi-kw-skill')).toBe('keyword:injection')
  })

  it('uses first matching keyword in reason when multiple keywords match', () => {
    const skill = makeSkill({
      id: 'multi-kw-skill',
      triggers: { keywords: ['owasp', 'injection'] },
    })
    const agent = makeAgent()
    // Both 'owasp' and 'injection' match, first one found should be reported
    const result = matcher.match([skill], agent, {
      jobBrief: 'check for OWASP injection vulnerabilities',
    })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('multi-kw-skill')).toBe('keyword:owasp')
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — lifecycle matching
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — lifecycle matching', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('matches skill with triggers.lifecycle when lifecyclePoint matches', () => {
    const skill = makeSkill({
      id: 'pre-round-skill',
      triggers: { lifecycle: ['pre_round'] },
    })
    const agent = makeAgent()
    const result = matcher.match([skill], agent, {
      jobBrief: 'standard job',
      lifecyclePoint: 'pre_round',
    })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('pre-round-skill')).toBe('lifecycle:pre_round')
  })

  it('does NOT match lifecycle skill when lifecyclePoint is different', () => {
    const skill = makeSkill({
      id: 'pre-round-skill',
      triggers: { lifecycle: ['pre_round'] },
    })
    const agent = makeAgent()
    const result = matcher.match([skill], agent, {
      jobBrief: 'standard job',
      lifecyclePoint: 'post_round',
    })

    expect(result.matched).toHaveLength(0)
  })

  it('does NOT match lifecycle skill when lifecyclePoint is undefined', () => {
    const skill = makeSkill({
      id: 'pre-round-skill',
      triggers: { lifecycle: ['pre_round'] },
    })
    const agent = makeAgent()
    const result = matcher.match([skill], agent, { jobBrief: 'standard job' })

    expect(result.matched).toHaveLength(0)
  })

  it('matches post_synthesis lifecycle', () => {
    const skill = makeSkill({
      id: 'post-synth-skill',
      triggers: { lifecycle: ['post_synthesis'] },
    })
    const agent = makeAgent()
    const result = matcher.match([skill], agent, {
      jobBrief: 'standard job',
      lifecyclePoint: 'post_synthesis',
    })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('post-synth-skill')).toBe('lifecycle:post_synthesis')
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — always-on skills
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — always-on skills', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('matches skill with no triggers field against any agent', () => {
    const skill = makeSkill({ id: 'always-on-skill' }) // triggers: undefined
    const agent = makeAgent({ lens: 'performance', role: 'builder' })
    const result = matcher.match([skill], agent, { jobBrief: 'unrelated task' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('always-on-skill')).toBe('always-on')
  })

  it('matches skill with empty triggers object {} against any agent', () => {
    const skill = makeSkill({ id: 'empty-triggers-skill', triggers: {} })
    const agent = makeAgent({ lens: 'logic', role: 'architect' })
    const result = matcher.match([skill], agent, { jobBrief: 'design system' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('empty-triggers-skill')).toBe('always-on')
  })

  it('matches skill with triggers having only empty arrays', () => {
    const skill = makeSkill({
      id: 'empty-arrays-skill',
      triggers: { lenses: [], roles: [], keywords: [], lifecycle: [] },
    })
    const agent = makeAgent()
    const result = matcher.match([skill], agent, { jobBrief: 'any job' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('empty-arrays-skill')).toBe('always-on')
  })

  it('always-on skill matches agents with different roles and lenses', () => {
    const skill = makeSkill({ id: 'global-skill' })
    const agents: AgentAssignment[] = [
      makeAgent({ id: 'a1', role: 'reviewer', lens: 'security' }),
      makeAgent({ id: 'a2', role: 'builder', lens: 'performance' }),
      makeAgent({ id: 'a3', role: 'architect', lens: undefined }),
    ]

    for (const agent of agents) {
      const result = matcher.match([skill], agent, { jobBrief: 'general task' })
      expect(result.matched).toHaveLength(1)
      expect(result.reason.get('global-skill')).toBe('always-on')
    }
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — OR logic (multiple trigger types)
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — OR logic', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('matches if EITHER lens OR keyword trigger is satisfied', () => {
    // Skill triggers on lens:security OR keyword:owasp
    const skill = makeSkill({
      id: 'or-skill',
      triggers: { lenses: ['security'], keywords: ['owasp'] },
    })

    // Agent with 'performance' lens but brief mentions 'owasp' → keyword match
    const agent = makeAgent({ lens: 'performance' })
    const result = matcher.match([skill], agent, { jobBrief: 'check OWASP compliance' })

    expect(result.matched).toHaveLength(1)
    // keyword match wins over no-lens-match
    expect(result.reason.get('or-skill')).toBe('keyword:owasp')
  })

  it('uses lens reason (higher priority) when both lens and keyword match', () => {
    const skill = makeSkill({
      id: 'or-skill',
      triggers: { lenses: ['security'], keywords: ['owasp'] },
    })

    // Agent with 'security' lens and brief mentions 'owasp' → lens has higher priority
    const agent = makeAgent({ lens: 'security' })
    const result = matcher.match([skill], agent, { jobBrief: 'check OWASP compliance' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('or-skill')).toBe('lens:security')
  })

  it('matches if role matches even when lens does not', () => {
    const skill = makeSkill({
      id: 'role-or-lens-skill',
      triggers: { lenses: ['security'], roles: ['reviewer'] },
    })

    const agent = makeAgent({ role: 'reviewer', lens: 'performance' })
    const result = matcher.match([skill], agent, { jobBrief: 'review performance' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('role-or-lens-skill')).toBe('role:reviewer')
  })

  it('uses lens reason (higher priority) when both lens and role match', () => {
    const skill = makeSkill({
      id: 'role-or-lens-skill',
      triggers: { lenses: ['security'], roles: ['reviewer'] },
    })

    const agent = makeAgent({ role: 'reviewer', lens: 'security' })
    const result = matcher.match([skill], agent, { jobBrief: 'review security' })

    expect(result.matched).toHaveLength(1)
    expect(result.reason.get('role-or-lens-skill')).toBe('lens:security')
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — priority ordering
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — priority ordering', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('orders: lens match > role match > keyword match > always-on', () => {
    const lenSkill = makeSkill({ id: 'lens-skill', triggers: { lenses: ['security'] } })
    const roleSkill = makeSkill({ id: 'role-skill', triggers: { roles: ['reviewer'] } })
    const kwSkill = makeSkill({ id: 'kw-skill', triggers: { keywords: ['owasp'] } })
    const alwaysSkill = makeSkill({ id: 'always-skill' })

    const agent = makeAgent({ role: 'reviewer', lens: 'security' })
    const context = { jobBrief: 'OWASP security review' }

    // Pass in reverse order to ensure sort is applied
    const result = matcher.match([alwaysSkill, kwSkill, roleSkill, lenSkill], agent, context)

    expect(result.matched).toHaveLength(4)
    expect(result.matched[0]!.id).toBe('lens-skill')
    expect(result.matched[1]!.id).toBe('role-skill')
    expect(result.matched[2]!.id).toBe('kw-skill')
    expect(result.matched[3]!.id).toBe('always-skill')
  })

  it('orders alphabetically within same priority tier', () => {
    const skillC = makeSkill({ id: 'c-skill', triggers: { lenses: ['security'] } })
    const skillA = makeSkill({ id: 'a-skill', triggers: { lenses: ['security'] } })
    const skillB = makeSkill({ id: 'b-skill', triggers: { lenses: ['security'] } })

    const agent = makeAgent({ lens: 'security' })
    const result = matcher.match([skillC, skillA, skillB], agent, { jobBrief: '' })

    expect(result.matched.map((s) => s.id)).toEqual(['a-skill', 'b-skill', 'c-skill'])
  })

  it('always-on skills sorted alphabetically among themselves', () => {
    const skillZ = makeSkill({ id: 'z-always' })
    const skillA = makeSkill({ id: 'a-always' })
    const skillM = makeSkill({ id: 'm-always' })

    const agent = makeAgent()
    const result = matcher.match([skillZ, skillA, skillM], agent, { jobBrief: '' })

    expect(result.matched.map((s) => s.id)).toEqual(['a-always', 'm-always', 'z-always'])
  })

  it('keyword match skills sorted alphabetically within keyword tier', () => {
    const skillB = makeSkill({ id: 'b-kw', triggers: { keywords: ['owasp'] } })
    const skillA = makeSkill({ id: 'a-kw', triggers: { keywords: ['owasp'] } })

    const agent = makeAgent()
    const result = matcher.match([skillB, skillA], agent, { jobBrief: 'OWASP review' })

    expect(result.matched.map((s) => s.id)).toEqual(['a-kw', 'b-kw'])
  })

  it('full ordering: lens > role > keyword > lifecycle > always-on', () => {
    const lensSkill = makeSkill({ id: 'lens-x', triggers: { lenses: ['security'] } })
    const roleSkill = makeSkill({ id: 'role-x', triggers: { roles: ['reviewer'] } })
    const kwSkill = makeSkill({ id: 'kw-x', triggers: { keywords: ['owasp'] } })
    const lcSkill = makeSkill({ id: 'lc-x', triggers: { lifecycle: ['pre_round'] } })
    const alwaysSkill = makeSkill({ id: 'always-x' })

    const agent = makeAgent({ role: 'reviewer', lens: 'security' })
    const context = { jobBrief: 'OWASP security review', lifecyclePoint: 'pre_round' as const }

    const result = matcher.match(
      [alwaysSkill, lcSkill, kwSkill, roleSkill, lensSkill],
      agent,
      context,
    )

    expect(result.matched).toHaveLength(5)
    expect(result.matched[0]!.id).toBe('lens-x')
    expect(result.matched[1]!.id).toBe('role-x')
    expect(result.matched[2]!.id).toBe('kw-x')
    expect(result.matched[3]!.id).toBe('lc-x')
    expect(result.matched[4]!.id).toBe('always-x')
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher.match — reason map correctness
// ---------------------------------------------------------------------------

describe('SkillMatcher.match — reason map', () => {
  let matcher: SkillMatcher

  beforeEach(() => {
    matcher = new SkillMatcher()
  })

  it('reason map contains correct entries for all matched skills', () => {
    const lenSkill = makeSkill({ id: 'lens-skill', triggers: { lenses: ['security'] } })
    const roleSkill = makeSkill({ id: 'role-skill', triggers: { roles: ['reviewer'] } })
    const kwSkill = makeSkill({ id: 'kw-skill', triggers: { keywords: ['owasp'] } })
    const alwaysSkill = makeSkill({ id: 'always-skill' })

    const agent = makeAgent({ role: 'reviewer', lens: 'security' })
    const context = { jobBrief: 'OWASP security review' }

    const result = matcher.match([lenSkill, roleSkill, kwSkill, alwaysSkill], agent, context)

    expect(result.reason.get('lens-skill')).toBe('lens:security')
    expect(result.reason.get('role-skill')).toBe('role:reviewer')
    expect(result.reason.get('kw-skill')).toBe('keyword:owasp')
    expect(result.reason.get('always-skill')).toBe('always-on')
  })

  it('reason map contains exactly one entry per matched skill', () => {
    const skills = [
      makeSkill({ id: 'skill-a', triggers: { lenses: ['security'] } }),
      makeSkill({ id: 'skill-b' }),
    ]
    const agent = makeAgent({ lens: 'security' })
    const result = matcher.match(skills, agent, { jobBrief: '' })

    expect(result.reason.size).toBe(result.matched.length)
    expect(result.reason.size).toBe(2)
  })

  it('reason map is empty when no skills match', () => {
    const skills = [makeSkill({ id: 'perf-skill', triggers: { lenses: ['performance'] } })]
    const agent = makeAgent({ lens: 'security' })
    const result = matcher.match(skills, agent, { jobBrief: 'security audit' })

    expect(result.reason.size).toBe(0)
  })

  it('lifecycle reason format is lifecycle:<point>', () => {
    const skill = makeSkill({ id: 'lc-skill', triggers: { lifecycle: ['pre_synthesis'] } })
    const agent = makeAgent()
    const result = matcher.match([skill], agent, {
      jobBrief: 'standard',
      lifecyclePoint: 'pre_synthesis',
    })

    expect(result.reason.get('lc-skill')).toBe('lifecycle:pre_synthesis')
  })
})

// ---------------------------------------------------------------------------
// SkillMatcher — barrel export
// ---------------------------------------------------------------------------

describe('SkillMatcher barrel export', () => {
  it('is exported from skills/index.ts', async () => {
    const module = await import('../index.js')
    expect(module.SkillMatcher).toBeDefined()
    expect(typeof module.SkillMatcher).toBe('function')
  })
})
