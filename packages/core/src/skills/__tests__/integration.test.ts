/**
 * Task 1.8 — Integration Tests: Full skill pipeline
 *
 * Exercises the complete flow:
 *   load skills from disk → match to agent → inject into context → verify context
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SkillParser } from '../parser.js'
import { SkillLoader } from '../loader.js'
import { SkillMatcher } from '../matcher.js'
import { SkillInjector } from '../injector.js'
import { ContextBuilder } from '../../context/context-builder.js'

import type { TokenEstimator } from '../../interfaces/token-estimator.js'
import type { ContextBudgetManager } from '../../interfaces/context-budget-manager.js'
import type { AgentContext } from '../../types/context.js'
import type { AgentAssignment } from '../../types/agent.js'
import type { Job } from '../../types/job.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple estimator: ~4 chars per token (as specified in task description) */
const tokenEstimator: TokenEstimator = {
  estimate: (text: string) => Math.ceil(text.length / 4),
}

/** Pass-through budget manager for Phase A */
const budgetManager: ContextBudgetManager = {
  fitToLimit: (ctx: AgentContext, _limit: number) => ctx,
}

/** Build the full pipeline */
function makeContextBuilder(): ContextBuilder {
  const matcher = new SkillMatcher()
  const injector = new SkillInjector(tokenEstimator)
  return new ContextBuilder(budgetManager, tokenEstimator, matcher, injector)
}

/** Convenience: create loader instance */
function makeLoader(): SkillLoader {
  const parser = new SkillParser(tokenEstimator)
  return new SkillLoader(parser)
}

/** Baseline job used across tests */
function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    title: 'Test Job',
    mode: 'code_review',
    brief: 'Review for security vulnerabilities',
    status: 'running',
    protocol: 'reviewer_wave',
    scope: {
      primaryTargets: ['src/'],
      excludedTargets: [],
      referencePolicy: { enabled: false, depth: 'same_file' },
      outOfScopeHandling: 'ignore',
      allowDebateExpansion: false,
    },
    targetResolution: {
      entryTarget: '/tmp/workspace/src',
      entryKind: 'directory',
      resolvedFiles: ['src/'],
      discovery: [
        {
          path: '/tmp/workspace/src',
          reason: 'directory_walk',
        },
      ],
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
      maxConcurrentAgents: 3,
      pausePointsEnabled: false,
      synthesisConfig: { provider: 'architect_provider', rerunnable: true },
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Baseline agent used across tests */
function makeAgent(overrides: Partial<AgentAssignment> = {}): AgentAssignment {
  return {
    id: 'agent-1',
    agentConfigId: 'config-1',
    role: 'reviewer',
    lens: 'security',
    connectionType: 'api',
    providerKey: 'test-provider',
    modelOrCommand: 'test-model',
    protocol: 'reviewer_wave',
    enabled: true,
    allowReferenceScan: false,
    canWriteCode: false,
    ...overrides,
  }
}

/**
 * Write a SKILL.md file inside a subdirectory of the given skills base path.
 * Creates: <skillsBasePath>/<dirName>/SKILL.md
 */
async function createSkillFile(
  skillsBasePath: string,
  dirName: string,
  content: string,
): Promise<void> {
  const skillDir = join(skillsBasePath, dirName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), content, 'utf-8')
}

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agent-orchestra-integration-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 1.8.1 — Skill injected into agent context when lens matches
// ---------------------------------------------------------------------------

describe('1.8.1 — Skill injected into agent context when lens matches', () => {
  it('injects security-review skill when agent lens=security', async () => {
    // Arrange: workspace with security-review skill (triggers: lenses=[security])
    const skillsDir = join(tmpDir, '.agent-orchestra', 'skills')
    await mkdir(skillsDir, { recursive: true })

    const securitySkillContent = `---
name: Security Review
description: Checks for security vulnerabilities in code
triggers:
  lenses:
    - security
---

## Security Review Checklist

Always check for SQL injection, XSS, and CSRF vulnerabilities.
Validate all user inputs and sanitize outputs.
`
    await createSkillFile(skillsDir, 'security-review', securitySkillContent)

    const loader = makeLoader()
    const { skills } = await loader.loadFromWorkspace(tmpDir)

    const agent = makeAgent({ lens: 'security' })
    const job = makeJob()
    const builder = makeContextBuilder()

    // Act
    const result = builder.buildFor(agent, job, { skills })

    // Assert
    expect(result.skillContext).toBeDefined()
    expect(result.skillContext).toContain('## Skill: Security Review')
    expect(result.skillContext).toContain('SQL injection')
  })
})

// ---------------------------------------------------------------------------
// 1.8.2 — Skill NOT injected when lens doesn't match
// ---------------------------------------------------------------------------

describe('1.8.2 — Skill NOT injected when lens does not match', () => {
  it('does not inject security skill when agent lens=performance', async () => {
    // Arrange: workspace has security-review skill (triggers: lenses=[security])
    const skillsDir = join(tmpDir, '.agent-orchestra', 'skills')
    await mkdir(skillsDir, { recursive: true })

    const securitySkillContent = `---
name: Security Review
description: Checks for security vulnerabilities
triggers:
  lenses:
    - security
---

Security review prompt content goes here.
`
    await createSkillFile(skillsDir, 'security-review', securitySkillContent)

    const loader = makeLoader()
    const { skills } = await loader.loadFromWorkspace(tmpDir)

    // Agent has performance lens — should NOT match security skill
    const agent = makeAgent({ lens: 'performance' })
    const job = makeJob()
    const builder = makeContextBuilder()

    // Act
    const result = builder.buildFor(agent, job, { skills })

    // Assert
    expect(result.skillContext).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 1.8.3 — Progressive disclosure under tight budget
// ---------------------------------------------------------------------------

describe('1.8.3 — Progressive disclosure under tight budget', () => {
  it('uses summary with disclosure note when full content exceeds budget', async () => {
    // Arrange: a skill whose body has a short first paragraph and a very long second paragraph.
    // The SkillParser.generateSummary() will accumulate whole paragraphs up to 500 tokens.
    // With the first paragraph being ~22 tokens and the second being ~970 tokens,
    // the generated summary = only the first paragraph (~22 tokens).
    //
    // Budget math (20% default allocation):
    //   tokenLimit = 1000  =>  skillBudget = 200 tokens
    //   full content = header (~10 tokens) + body (~992 tokens) = ~1002 tokens  => does NOT fit
    //   summary content = header_summary (~13 tokens) + para1 (~22 tokens) + footer (~18 tokens)
    //                   = ~53 tokens  => FITS in 200 tokens
    // => progressive disclosure is triggered (summary shown, not full content)
    const skillsDir = join(tmpDir, '.agent-orchestra', 'skills')
    await mkdir(skillsDir, { recursive: true })

    const shortPara =
      'Review all inputs for SQL injection, XSS, and CSRF vulnerabilities before proceeding.'

    const longPara =
      'A very detailed, comprehensive, exhaustive security analysis guide that covers OWASP Top 10 ' +
      'vulnerabilities in extreme detail, including injection flaws, broken authentication, sensitive ' +
      'data exposure, XML external entities, broken access control, security misconfiguration, ' +
      'cross-site scripting, insecure deserialization, components with known vulnerabilities, and ' +
      'insufficient logging and monitoring practices across all layers of the application stack. '

    // The body must be >2000 chars so the full content tokens (~992) far exceed the 200-token budget.
    // The long paragraph repeated 10 times gives a body of ~3967 chars / ~992 tokens.
    const body = shortPara + '\n\n' + longPara.repeat(10)

    const largeSkillContent = `---
name: Large Security Skill
description: A very detailed security skill with lots of content
triggers:
  lenses:
    - security
---

${body}
`

    await createSkillFile(skillsDir, 'large-security-skill', largeSkillContent)

    const loader = makeLoader()
    const { skills } = await loader.loadFromWorkspace(tmpDir)

    // Sanity check: body is > 2000 chars and full content tokens >> 200
    expect(skills).toHaveLength(1)
    expect(skills[0]!.promptContent.length).toBeGreaterThan(2000)
    const fullTokens = tokenEstimator.estimate(
      `## Skill: Large Security Skill\n\n${skills[0]!.promptContent}`,
    )
    expect(fullTokens).toBeGreaterThan(200)

    // Sanity check: summary tokens fit in the 200-token budget
    const summaryTokens = tokenEstimator.estimate(skills[0]!.promptSummary)
    expect(summaryTokens).toBeLessThan(200)

    const agent = makeAgent({ lens: 'security' })
    // tokenLimit=1000 => skillBudget = 20% of 1000 = 200 tokens
    const job = makeJob()
    const builder = makeContextBuilder()

    const result = builder.buildFor(agent, job, { skills, tokenLimit: 1000 })

    // Assert progressive disclosure was triggered
    expect(result.skillContext).toBeDefined()
    expect(result.skillContext).toContain('(summary)')
    expect(result.skillContext).toContain('[Full skill content available')
  })
})

// ---------------------------------------------------------------------------
// 1.8.4 — Multiple skills respect budget allocation
// ---------------------------------------------------------------------------

describe('1.8.4 — Multiple skills respect budget allocation', () => {
  it('respects skill budget across multiple matched skills', async () => {
    const skillsDir = join(tmpDir, '.agent-orchestra', 'skills')
    await mkdir(skillsDir, { recursive: true })

    // Small skill: ~200 tokens (800 chars of body)
    const smallBody = 'A'.repeat(700)
    const smallSkillContent = `---
name: Small Skill
description: A small security skill
triggers:
  lenses:
    - security
---

${smallBody}
`

    // Medium skill: ~400 tokens (1600 chars of body)
    const mediumBody = 'B'.repeat(1500)
    const mediumSkillContent = `---
name: Medium Skill
description: A medium security skill
triggers:
  lenses:
    - security
---

${mediumBody}
`

    // Large skill: ~1000 tokens (4000 chars of body)
    const largeBody = 'C'.repeat(3900)
    const largeSkillContent = `---
name: Large Skill
description: A large security skill
triggers:
  lenses:
    - security
---

${largeBody}
`

    await createSkillFile(skillsDir, 'small-skill', smallSkillContent)
    await createSkillFile(skillsDir, 'medium-skill', mediumSkillContent)
    await createSkillFile(skillsDir, 'large-skill', largeSkillContent)

    const loader = makeLoader()
    const { skills } = await loader.loadFromWorkspace(tmpDir)
    expect(skills).toHaveLength(3)

    const agent = makeAgent({ lens: 'security' })
    // skillBudgetPercent = 20%, tokenLimit = 2000 => skillBudget = 400 tokens
    const job = makeJob({
      runtimeConfig: {
        maxConcurrentAgents: 3,
        pausePointsEnabled: false,
        synthesisConfig: { provider: 'architect_provider', rerunnable: true },
      },
    })
    const builder = makeContextBuilder()

    const result = builder.buildFor(agent, job, { skills, tokenLimit: 2000 })

    // Skill budget = 20% of 2000 = 400 tokens
    // Small skill header + body ≈ (700 + ~20 header chars) / 4 ≈ ~180 tokens → fits
    // Medium skill is ~400 tokens → may use summary or get skipped based on remaining budget
    // Large skill → likely summary or skipped

    expect(result.skillContext).toBeDefined()

    // The small skill (alphabetically first among security lens skills) should be injected
    // (it's ~180 tokens and the budget is 400)
    expect(result.skillContext).toContain('Small Skill')

    // Verify total token usage stays within budget
    const skillBudget = Math.floor(0.2 * 2000) // 400 tokens
    const usedTokens = tokenEstimator.estimate(result.skillContext ?? '')
    expect(usedTokens).toBeLessThanOrEqual(skillBudget)
  })
})

// ---------------------------------------------------------------------------
// 1.8.5 — Always-on skill injected for all agents
// ---------------------------------------------------------------------------

describe('1.8.5 — Always-on skill injected for all agents', () => {
  it('injects coding-standards skill (no triggers) for any agent lens', async () => {
    const skillsDir = join(tmpDir, '.agent-orchestra', 'skills')
    await mkdir(skillsDir, { recursive: true })

    // Always-on skill: no triggers block
    const codingStandardsContent = `---
name: Coding Standards
description: Always-on coding standards for all agents
---

## Coding Standards

Follow these coding standards at all times:
- Use consistent naming conventions
- Write clear and concise comments
- Avoid magic numbers; use named constants
`

    await createSkillFile(skillsDir, 'coding-standards', codingStandardsContent)

    const loader = makeLoader()
    const { skills } = await loader.loadFromWorkspace(tmpDir)
    expect(skills).toHaveLength(1)
    expect(skills[0]!.triggers).toBeUndefined()

    // Use a completely different lens — should still inject
    const agent = makeAgent({ lens: 'performance' })
    const job = makeJob()
    const builder = makeContextBuilder()

    const result = builder.buildFor(agent, job, { skills })

    expect(result.skillContext).toBeDefined()
    expect(result.skillContext).toContain('Coding Standards')
    expect(result.skillContext).toContain('naming conventions')
  })

  it('injects coding-standards for an agent with no lens at all', async () => {
    const skillsDir = join(tmpDir, '.agent-orchestra', 'skills')
    await mkdir(skillsDir, { recursive: true })

    const codingStandardsContent = `---
name: Coding Standards
description: Always-on coding standards
---

Always use clear variable names and add meaningful comments.
`

    await createSkillFile(skillsDir, 'coding-standards', codingStandardsContent)

    const loader = makeLoader()
    const { skills } = await loader.loadFromWorkspace(tmpDir)

    // Agent with no lens (architect role)
    const agent = makeAgent({ role: 'architect', lens: undefined })
    const job = makeJob()
    const builder = makeContextBuilder()

    const result = builder.buildFor(agent, job, { skills })

    expect(result.skillContext).toBeDefined()
    expect(result.skillContext).toContain('Coding Standards')
  })
})

// ---------------------------------------------------------------------------
// 1.8.6 — Backward compatibility — no skills directory
// ---------------------------------------------------------------------------

describe('1.8.6 — Backward compatibility — no skills directory', () => {
  it('returns undefined skillContext and no errors when no skills directory exists', async () => {
    // Arrange: workspace with NO .agent-orchestra/skills/ directory
    // (tmpDir itself exists, but no .agent-orchestra/skills/ subdirectory)

    const loader = makeLoader()
    const { skills, errors } = await loader.loadFromWorkspace(tmpDir)

    // Should load 0 skills and produce 0 errors
    expect(skills).toHaveLength(0)
    expect(errors).toHaveLength(0)

    const agent = makeAgent({ lens: 'security' })
    const job = makeJob()
    const builder = makeContextBuilder()

    // Act: call buildFor with no skills
    const result = builder.buildFor(agent, job, { skills })

    // Assert: skillContext is undefined, no errors thrown, other fields present
    expect(result.skillContext).toBeUndefined()
    expect(result.role).toBe('reviewer')
    expect(result.mode).toBe('code_review')
    expect(result.pinned).toBeDefined()
    expect(result.evidence).toBeDefined()
  })

  it('works correctly when options.skills is omitted entirely', () => {
    const agent = makeAgent({ lens: 'security' })
    const job = makeJob()
    const builder = makeContextBuilder()

    // Act: call buildFor without skills option at all
    expect(() => {
      const result = builder.buildFor(agent, job)
      expect(result.skillContext).toBeUndefined()
      expect(result.role).toBe('reviewer')
    }).not.toThrow()
  })
})
