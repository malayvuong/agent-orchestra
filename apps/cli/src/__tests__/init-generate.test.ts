import { describe, it, expect } from 'vitest'
import type { ProjectProfile } from '../init/detect.js'
import {
  generateAgentsMd,
  generateAgentsSection,
  generatePolicyYaml,
  generateSkillsetsYaml,
} from '../init/generate.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides?: Partial<ProjectProfile>): ProjectProfile {
  return {
    kind: 'node-ts',
    hasTests: true,
    hasDocs: false,
    recommendedSuperpowers: ['security-review', 'test-generation', 'auto-fix-lint'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// AGENTS.md generation — node-ts
// ---------------------------------------------------------------------------

describe('generateAgentsMd — node-ts', () => {
  const profile = makeProfile()
  const content = generateAgentsMd(profile)

  it('contains Agent Orchestra header', () => {
    expect(content).toContain('# Agent Instructions')
    expect(content).toContain('Agent Orchestra')
  })

  it('contains recommended superpower commands', () => {
    expect(content).toContain('--superpower security-review')
    expect(content).toContain('--superpower test-generation')
    expect(content).toContain('--superpower auto-fix-lint')
  })

  it('contains use-case guidance', () => {
    expect(content).toContain('security-sensitive')
    expect(content).toContain('testing gaps')
  })

  it('contains approval note for auto-fix-lint', () => {
    expect(content).toContain('approval')
  })

  it('contains superpowers table', () => {
    expect(content).toContain('| Superpower | Purpose |')
    expect(content).toContain('security-review')
    expect(content).toContain('plan-review')
  })
})

// ---------------------------------------------------------------------------
// AGENTS.md generation — generic/docs
// ---------------------------------------------------------------------------

describe('generateAgentsMd — generic/docs repo', () => {
  const profile = makeProfile({
    kind: 'generic',
    hasTests: false,
    hasDocs: true,
    recommendedSuperpowers: ['security-review', 'plan-review'],
  })
  const content = generateAgentsMd(profile)

  it('contains plan-review recommendation', () => {
    expect(content).toContain('--superpower plan-review')
  })

  it('mentions generic/docs detection', () => {
    expect(content).toContain('generic/docs repository')
    expect(content).toContain('plan-review')
  })

  it('does not recommend auto-fix-lint', () => {
    expect(content).not.toContain('--superpower auto-fix-lint`')
  })
})

// ---------------------------------------------------------------------------
// AGENTS.md generation — python
// ---------------------------------------------------------------------------

describe('generateAgentsMd — python', () => {
  const profile = makeProfile({
    kind: 'python',
    hasTests: true,
    hasDocs: false,
    recommendedSuperpowers: ['security-review', 'test-generation'],
  })
  const content = generateAgentsMd(profile)

  it('recommends security-review and test-generation', () => {
    expect(content).toContain('--superpower security-review')
    expect(content).toContain('--superpower test-generation')
  })
})

// ---------------------------------------------------------------------------
// Append section generation
// ---------------------------------------------------------------------------

describe('generateAgentsSection', () => {
  const profile = makeProfile()
  const section = generateAgentsSection(profile)

  it('starts with Agent Orchestra heading', () => {
    expect(section).toContain('## Agent Orchestra')
  })

  it('contains recommended commands', () => {
    expect(section).toContain('--superpower security-review')
  })

  it('is shorter than full AGENTS.md', () => {
    const full = generateAgentsMd(profile)
    expect(section.length).toBeLessThan(full.length)
  })
})

// ---------------------------------------------------------------------------
// Policy YAML generation
// ---------------------------------------------------------------------------

describe('generatePolicyYaml', () => {
  it('generates valid YAML-like content', () => {
    const content = generatePolicyYaml(makeProfile())
    expect(content).toContain('defaultAction: deny')
    expect(content).toContain('networkAllowed: false')
    expect(content).toContain('fs.read')
    expect(content).toContain('fs.write')
  })

  it('uses ./src/** for node-ts', () => {
    const content = generatePolicyYaml(makeProfile({ kind: 'node-ts' }))
    expect(content).toContain('"./src/**"')
  })

  it('uses ./**/*.py for python', () => {
    const content = generatePolicyYaml(makeProfile({ kind: 'python' }))
    expect(content).toContain('"./**/*.py"')
  })

  it('uses ./src/** for rust', () => {
    const content = generatePolicyYaml(makeProfile({ kind: 'rust' }))
    expect(content).toContain('"./src/**"')
  })
})

// ---------------------------------------------------------------------------
// Skillsets YAML generation
// ---------------------------------------------------------------------------

describe('generateSkillsetsYaml', () => {
  it('generates a template with empty skillsets array', () => {
    const content = generateSkillsetsYaml(makeProfile())
    expect(content).toContain('skillsets: []')
  })

  it('contains example in comments', () => {
    const content = generateSkillsetsYaml(makeProfile())
    expect(content).toContain('# Example:')
    expect(content).toContain('# skillsets:')
  })
})
