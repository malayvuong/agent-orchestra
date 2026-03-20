import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProgram } from '../program.js'
import type { SkillDefinition, SkillLoadResult } from '@agent-orchestra/core'
import { SkillLoader } from '@agent-orchestra/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillDefinition> & { id: string }): SkillDefinition {
  const { id } = overrides
  return {
    version: '1.0.0',
    name: id,
    description: `Skill ${id}`,
    skillType: 'prompt',
    source: { type: 'local', path: `/workspace/.agent-orchestra/skills/${id}/SKILL.md` },
    promptContent: 'A'.repeat(400), // ~100 tokens
    promptSummary: 'Summary content here.',
    ...overrides,
  }
}

function captureConsole(): { output: string[]; restore: () => void } {
  const output: string[] = []
  const originalLog = console.log
  const originalError = console.error
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(' '))
  })
  return {
    output,
    restore: () => {
      console.log = originalLog
      console.error = originalError
      vi.restoreAllMocks()
    },
  }
}

// ---------------------------------------------------------------------------
// skills list
// ---------------------------------------------------------------------------

describe('skills list command', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('displays loaded skills and no errors when workspace has skills', async () => {
    const skills = [
      makeSkill({ id: 'security-review', version: '1.0.0', triggers: { lenses: ['security'] } }),
      makeSkill({ id: 'test-generator', version: '0.9.0', triggers: { lenses: ['testing'] } }),
    ]
    const loadResult: SkillLoadResult = { skills, errors: [] }

    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue(loadResult)

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'skills', 'list', '--path', '/workspace'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Loaded skills (2 found)')
    expect(combined).toContain('security-review')
    expect(combined).toContain('test-generator')
    expect(combined).not.toContain('Errors')
  })

  it('displays errors section when load errors exist', async () => {
    const loadResult: SkillLoadResult = {
      skills: [],
      errors: [
        { path: '.agent-orchestra/skills/broken-skill/', error: 'Invalid YAML in frontmatter' },
      ],
    }

    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue(loadResult)

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'skills', 'list', '--path', '/workspace'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Errors (1)')
    expect(combined).toContain('broken-skill')
    expect(combined).toContain('Invalid YAML in frontmatter')
  })

  it('displays "No skills found" when workspace is empty', async () => {
    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({
      skills: [],
      errors: [],
    })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'skills', 'list', '--path', '/empty'])

    restore()

    expect(output.join('\n')).toContain('No skills found')
  })

  it('displays both skills and errors when both exist', async () => {
    const skills = [makeSkill({ id: 'good-skill', version: '1.0.0' })]
    const errors = [{ path: '/bad/skill', error: 'Parse failure' }]

    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({ skills, errors })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'skills', 'list', '--path', '/workspace'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Loaded skills (1 found)')
    expect(combined).toContain('good-skill')
    expect(combined).toContain('Errors (1)')
    expect(combined).toContain('Parse failure')
  })
})

// ---------------------------------------------------------------------------
// skills show
// ---------------------------------------------------------------------------

describe('skills show command', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('displays skill details for a known skill ID', async () => {
    const skill = makeSkill({
      id: 'security-review',
      version: '1.0.0',
      license: 'MIT',
      triggers: { lenses: ['security'], keywords: ['owasp', 'vulnerability'] },
      promptSummary: 'Review code changes for OWASP Top 10 vulnerabilities.',
    })

    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({
      skills: [skill],
      errors: [],
    })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync([
      'node',
      'agent-orchestra',
      'skills',
      'show',
      'security-review',
      '--path',
      '/workspace',
    ])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('security-review v1.0.0')
    expect(combined).toContain('License: MIT')
    expect(combined).toContain('lenses=[security]')
    expect(combined).toContain('keywords=[owasp, vulnerability]')
    expect(combined).toContain('tokens')
    expect(combined).toContain('--- Summary ---')
    expect(combined).toContain('Review code changes for OWASP Top 10 vulnerabilities.')
  })

  it('exits with error when skill ID is not found', async () => {
    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({
      skills: [makeSkill({ id: 'other-skill', version: '1.0.0' })],
      errors: [],
    })

    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await expect(
      program.parseAsync([
        'node',
        'agent-orchestra',
        'skills',
        'show',
        'missing-skill',
        '--path',
        '/workspace',
      ]),
    ).rejects.toThrow()

    restore()
    processExitSpy.mockRestore()

    const combined = output.join('\n')
    expect(combined).toContain('missing-skill')
    expect(combined).toContain('not found')
  })

  it('shows "always-on" when skill has no triggers', async () => {
    const skill = makeSkill({ id: 'always-skill', version: '1.0.0' })
    // no triggers property

    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({
      skills: [skill],
      errors: [],
    })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync([
      'node',
      'agent-orchestra',
      'skills',
      'show',
      'always-skill',
      '--path',
      '/workspace',
    ])

    restore()

    expect(output.join('\n')).toContain('always-on')
  })
})

// ---------------------------------------------------------------------------
// skills match
// ---------------------------------------------------------------------------

describe('skills match command', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows matched and unmatched skills', async () => {
    const skills = [
      makeSkill({ id: 'security-review', version: '1.0.0', triggers: { lenses: ['security'] } }),
      makeSkill({ id: 'test-generator', version: '0.9.0', triggers: { lenses: ['testing'] } }),
      makeSkill({ id: 'always-on-skill', version: '1.0.0' }), // no triggers
    ]

    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({ skills, errors: [] })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync([
      'node',
      'agent-orchestra',
      'skills',
      'match',
      '--lens',
      'security',
      '--brief',
      'Review for OWASP vulnerabilities',
      '--path',
      '/workspace',
    ])

    restore()

    const combined = output.join('\n')
    // security-review should match via lens
    expect(combined).toContain('security-review')
    expect(combined).toContain('lens:security')
    // always-on-skill should always match
    expect(combined).toContain('always-on-skill')
    expect(combined).toContain('always-on')
    // test-generator should be unmatched
    expect(combined).toContain('test-generator')
    expect(combined).toContain('does not match')
  })

  it('shows "none" when no skills are matched', async () => {
    const skills = [
      makeSkill({ id: 'test-generator', version: '0.9.0', triggers: { lenses: ['testing'] } }),
    ]

    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({ skills, errors: [] })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync([
      'node',
      'agent-orchestra',
      'skills',
      'match',
      '--lens',
      'security',
      '--path',
      '/workspace',
    ])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('(none)')
    expect(combined).toContain('test-generator')
    expect(combined).toContain('does not match')
  })

  it('shows "No skills loaded" when workspace is empty', async () => {
    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({
      skills: [],
      errors: [],
    })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'skills', 'match', '--path', '/empty'])

    restore()

    expect(output.join('\n')).toContain('No skills loaded')
  })

  it('matches by keyword when --brief contains a skill keyword', async () => {
    const skills = [
      makeSkill({
        id: 'sql-checker',
        version: '1.0.0',
        triggers: { keywords: ['sql', 'injection'] },
      }),
    ]

    vi.spyOn(SkillLoader.prototype, 'loadFromWorkspace').mockResolvedValue({ skills, errors: [] })

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync([
      'node',
      'agent-orchestra',
      'skills',
      'match',
      '--brief',
      'Check for SQL injection vulnerabilities',
      '--path',
      '/workspace',
    ])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('sql-checker')
    expect(combined).toContain('keyword:sql')
  })
})

// ---------------------------------------------------------------------------
// skills validate (stub)
// ---------------------------------------------------------------------------

describe('skills validate command', () => {
  it('prints not-implemented message', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'skills', 'validate'])

    restore()

    expect(output.join('\n')).toContain('not yet implemented')
  })
})
