import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ContextBuilder } from '../context-builder.js'
import { SkillMatcher } from '../../skills/matcher.js'
import { SkillInjector } from '../../skills/injector.js'
import type { ContextBudgetManager } from '../../interfaces/context-budget-manager.js'
import type { TokenEstimator } from '../../interfaces/token-estimator.js'
import type { AgentContext } from '../../types/context.js'
import type { AgentAssignment } from '../../types/agent.js'
import type { Job } from '../../types/job.js'
import type { SkillDefinition } from '../../skills/types.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Pass-through budget manager for Phase A testing */
function makePassThroughBudgetManager(): ContextBudgetManager {
  return {
    fitToLimit(context: AgentContext, _tokenLimit: number): AgentContext {
      return context
    },
  }
}

function makeWordCountEstimator(): TokenEstimator {
  return {
    estimate(text: string): number {
      if (text.trim() === '') return 0
      return text.trim().split(/\s+/).length
    },
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

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    title: 'Test Job',
    mode: 'plan',
    brief: 'Review the system architecture for potential issues.',
    status: 'running',
    protocol: 'single_challenger',
    scope: {
      primaryTargets: ['src/'],
      excludedTargets: [],
      referencePolicy: { enabled: false, depth: 'same_file' },
      outOfScopeHandling: 'ignore',
      allowDebateExpansion: false,
    },
    decisionLog: {
      lockedConstraints: [],
      acceptedDecisions: [],
      rejectedOptions: [],
      unresolvedItems: [],
    },
    agents: [],
    currentRoundIndex: 0,
    maxRounds: 3,
    templateVersions: {},
    runtimeConfig: {
      maxConcurrentAgents: 2,
      pausePointsEnabled: false,
      synthesisConfig: {
        provider: 'architect_provider',
        rerunnable: false,
      },
    },
    createdAt: '2026-03-21T00:00:00Z',
    updatedAt: '2026-03-21T00:00:00Z',
    ...overrides,
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

function makeContextBuilder(): ContextBuilder {
  return new ContextBuilder(
    makePassThroughBudgetManager(),
    makeWordCountEstimator(),
    new SkillMatcher(),
    new SkillInjector(makeWordCountEstimator()),
  )
}

// ---------------------------------------------------------------------------
// ContextBuilder — base context assembly
// ---------------------------------------------------------------------------

describe('ContextBuilder — assembles correct AgentContext from agent + job', () => {
  let builder: ContextBuilder

  beforeEach(() => {
    builder = makeContextBuilder()
  })

  it('sets role from agent.role', () => {
    const agent = makeAgent({ role: 'architect' })
    const job = makeJob({ mode: 'code_review' })
    const ctx = builder.buildFor(agent, job)

    expect(ctx.role).toBe('architect')
  })

  it('sets mode from job.mode', () => {
    const agent = makeAgent({ role: 'reviewer' })
    const job = makeJob({ mode: 'execution_review' })
    const ctx = builder.buildFor(agent, job)

    expect(ctx.mode).toBe('execution_review')
  })

  it('sets pinned.brief from job.brief', () => {
    const job = makeJob({ brief: 'Audit the payment service.' })
    const ctx = builder.buildFor(makeAgent(), job)

    expect(ctx.pinned.brief).toBe('Audit the payment service.')
  })

  it('sets pinned.scope from job.scope', () => {
    const job = makeJob()
    const ctx = builder.buildFor(makeAgent(), job)

    expect(ctx.pinned.scope).toBe(job.scope)
    expect(ctx.pinned.scope.primaryTargets).toEqual(['src/'])
  })

  it('sets pinned.decisionLog from job.decisionLog', () => {
    const job = makeJob()
    const ctx = builder.buildFor(makeAgent(), job)

    expect(ctx.pinned.decisionLog).toBe(job.decisionLog)
  })

  it('sets pinned.protocol from job.protocol', () => {
    const job = makeJob({ protocol: 'reviewer_wave' })
    const ctx = builder.buildFor(makeAgent(), job)

    expect(ctx.pinned.protocol).toBe('reviewer_wave')
  })

  it('initializes dynamic as empty object', () => {
    const ctx = builder.buildFor(makeAgent(), makeJob())

    expect(ctx.dynamic).toEqual({})
    expect(ctx.dynamic.currentRound).toBeUndefined()
    expect(ctx.dynamic.previousRoundSummary).toBeUndefined()
    expect(ctx.dynamic.clusters).toBeUndefined()
  })

  it('initializes evidence as empty array', () => {
    const ctx = builder.buildFor(makeAgent(), makeJob())

    expect(ctx.evidence).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ContextBuilder — without skills
// ---------------------------------------------------------------------------

describe('ContextBuilder — without skills', () => {
  it('skillContext is undefined when options.skills is not provided', () => {
    const builder = makeContextBuilder()
    const ctx = builder.buildFor(makeAgent(), makeJob())

    expect(ctx.skillContext).toBeUndefined()
  })

  it('skillContext is undefined when options is undefined', () => {
    const builder = makeContextBuilder()
    const ctx = builder.buildFor(makeAgent(), makeJob(), undefined)

    expect(ctx.skillContext).toBeUndefined()
  })

  it('skillContext is undefined when options.skills is empty array', () => {
    const builder = makeContextBuilder()
    const ctx = builder.buildFor(makeAgent(), makeJob(), { skills: [] })

    expect(ctx.skillContext).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ContextBuilder — with skills (skillContext populated)
// ---------------------------------------------------------------------------

describe('ContextBuilder — with skills', () => {
  it('populates skillContext when matching skills are provided', () => {
    const builder = makeContextBuilder()
    const agent = makeAgent({ role: 'reviewer' })
    const job = makeJob()

    // Always-on skill (no triggers) — will always match
    const skill = makeSkill({
      id: 'always-skill',
      name: 'Always Skill',
      promptContent: 'This skill always applies.',
      promptSummary: 'Always summary.',
    })

    const ctx = builder.buildFor(agent, job, { skills: [skill] })

    expect(ctx.skillContext).toBeDefined()
    expect(ctx.skillContext).toContain('## Skill: Always Skill')
    expect(ctx.skillContext).toContain('This skill always applies.')
  })

  it('skillContext is undefined when provided skills do not match the agent', () => {
    const builder = makeContextBuilder()
    // Agent is a builder but skill only triggers for 'architect'
    const agent = makeAgent({ role: 'builder', lens: undefined })
    const job = makeJob({ brief: 'Build the feature.' })

    const skill = makeSkill({
      id: 'architect-only',
      name: 'Architect Only',
      promptContent: 'Architect content.',
      promptSummary: 'Architect summary.',
      triggers: { roles: ['architect'] },
    })

    const ctx = builder.buildFor(agent, job, { skills: [skill] })

    expect(ctx.skillContext).toBeUndefined()
  })

  it('matches lens-triggered skill to agent with matching lens', () => {
    const builder = makeContextBuilder()
    const agent = makeAgent({ role: 'reviewer', lens: 'security' })
    const job = makeJob()

    const skill = makeSkill({
      id: 'security-skill',
      name: 'Security Skill',
      promptContent: 'Check OWASP vulnerabilities.',
      promptSummary: 'Security summary.',
      triggers: { lenses: ['security'] },
    })

    const ctx = builder.buildFor(agent, job, { skills: [skill] })

    expect(ctx.skillContext).toContain('## Skill: Security Skill')
  })
})

// ---------------------------------------------------------------------------
// ContextBuilder — skill budget calculation
// ---------------------------------------------------------------------------

describe('ContextBuilder — skill budget calculation', () => {
  it('uses 20% of 16000 = 3200 tokens as default skill budget', () => {
    // We'll use a spy on the injector to capture the skillBudgetTokens argument
    const estimator = makeWordCountEstimator()
    const injector = new SkillInjector(estimator)
    const injectSpy = vi.spyOn(injector, 'inject')

    const builder = new ContextBuilder(
      makePassThroughBudgetManager(),
      estimator,
      new SkillMatcher(),
      injector,
    )

    const agent = makeAgent()
    const job = makeJob() // no skillBudgetPercent set → default 20

    const skill = makeSkill({ id: 'test-skill', name: 'Test Skill', promptContent: 'Content.' })
    builder.buildFor(agent, job, { skills: [skill] })

    expect(injectSpy).toHaveBeenCalledOnce()
    const [, budgetArg] = injectSpy.mock.calls[0]!
    // 20% of 16000 = 3200
    expect(budgetArg).toBe(3200)
  })

  it('uses custom skillBudgetPercent from job.runtimeConfig', () => {
    const estimator = makeWordCountEstimator()
    const injector = new SkillInjector(estimator)
    const injectSpy = vi.spyOn(injector, 'inject')

    const builder = new ContextBuilder(
      makePassThroughBudgetManager(),
      estimator,
      new SkillMatcher(),
      injector,
    )

    const agent = makeAgent()
    const job = makeJob({
      runtimeConfig: {
        maxConcurrentAgents: 2,
        pausePointsEnabled: false,
        synthesisConfig: { provider: 'architect_provider', rerunnable: false },
        skillBudgetPercent: 10, // custom: 10% of 16000 = 1600
      },
    })

    const skill = makeSkill({ id: 'test-skill', name: 'Test Skill', promptContent: 'Content.' })
    builder.buildFor(agent, job, { skills: [skill] })

    expect(injectSpy).toHaveBeenCalledOnce()
    const [, budgetArg] = injectSpy.mock.calls[0]!
    // 10% of 16000 = 1600
    expect(budgetArg).toBe(1600)
  })

  it('respects custom tokenLimit from options', () => {
    const estimator = makeWordCountEstimator()
    const injector = new SkillInjector(estimator)
    const injectSpy = vi.spyOn(injector, 'inject')

    const builder = new ContextBuilder(
      makePassThroughBudgetManager(),
      estimator,
      new SkillMatcher(),
      injector,
    )

    const agent = makeAgent()
    const job = makeJob() // default 20%

    const skill = makeSkill({ id: 'test-skill', name: 'Test Skill', promptContent: 'Content.' })
    // custom tokenLimit: 8000 → 20% of 8000 = 1600
    builder.buildFor(agent, job, { skills: [skill], tokenLimit: 8000 })

    expect(injectSpy).toHaveBeenCalledOnce()
    const [, budgetArg] = injectSpy.mock.calls[0]!
    expect(budgetArg).toBe(1600)
  })
})

// ---------------------------------------------------------------------------
// ContextBuilder — budgetManager is called
// ---------------------------------------------------------------------------

describe('ContextBuilder — calls budgetManager.fitToLimit()', () => {
  it('calls fitToLimit with the assembled context and tokenLimit', () => {
    const budgetManager = makePassThroughBudgetManager()
    const fitSpy = vi.spyOn(budgetManager, 'fitToLimit')

    const builder = new ContextBuilder(
      budgetManager,
      makeWordCountEstimator(),
      new SkillMatcher(),
      new SkillInjector(makeWordCountEstimator()),
    )

    const agent = makeAgent()
    const job = makeJob()
    builder.buildFor(agent, job)

    expect(fitSpy).toHaveBeenCalledOnce()
    const [, limitArg] = fitSpy.mock.calls[0]!
    expect(limitArg).toBe(16_000) // default token limit
  })

  it('passes custom tokenLimit to fitToLimit', () => {
    const budgetManager = makePassThroughBudgetManager()
    const fitSpy = vi.spyOn(budgetManager, 'fitToLimit')

    const builder = new ContextBuilder(
      budgetManager,
      makeWordCountEstimator(),
      new SkillMatcher(),
      new SkillInjector(makeWordCountEstimator()),
    )

    builder.buildFor(makeAgent(), makeJob(), { tokenLimit: 4096 })

    expect(fitSpy).toHaveBeenCalledOnce()
    const [, limitArg] = fitSpy.mock.calls[0]!
    expect(limitArg).toBe(4096)
  })
})
