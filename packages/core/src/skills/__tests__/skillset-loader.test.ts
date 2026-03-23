import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillSetLoader } from '../skillset-loader.js'
import type { SkillSet, SkillDefinition } from '../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'skillset-loader-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/** Create .agent-orchestra directory and write skillsets.yaml */
async function writeSkillsetsYaml(workspacePath: string, content: string): Promise<void> {
  const dir = join(workspacePath, '.agent-orchestra')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'skillsets.yaml'), content, 'utf-8')
}

async function writeBuiltinSkillsetsYaml(workspacePath: string, content: string): Promise<void> {
  const dir = join(workspacePath, '.agent-orchestra')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'skillsets.builtin.yaml'), content, 'utf-8')
}

/** Build a minimal SkillDefinition for testing */
function makeSkill(id: string): SkillDefinition {
  return {
    id,
    version: '1.0.0',
    name: id,
    description: `Skill ${id}`,
    skillType: 'prompt',
    source: { type: 'local', path: `/skills/${id}/SKILL.md` },
    promptContent: `Content for ${id}`,
    promptSummary: `Summary for ${id}`,
  }
}

/** Build a minimal SkillSet for testing resolve() */
function makeSkillSet(overrides: Partial<SkillSet> & { id: string }): SkillSet {
  return {
    name: overrides.id,
    description: '',
    skillIds: [],
    contextBudgetPercent: 20,
    ...overrides,
  }
}

const VALID_YAML = `
skillsets:
  - id: security-review
    name: Security Review Pack
    description: OWASP checklist + dependency audit + secrets detection
    skills:
      - security-review
      - dependency-audit
      - secrets-hunt
    contextBudgetPercent: 25

  - id: testing
    name: Testing Pack
    description: Test generation and quality checks
    skills:
      - test-generator
      - coverage-check
    contextBudgetPercent: 15
`

// ---------------------------------------------------------------------------
// Test 1: Load valid skillsets from YAML
// ---------------------------------------------------------------------------

describe('SkillSetLoader.load — valid YAML', () => {
  it('loads all skillsets from a valid YAML file', async () => {
    await writeSkillsetsYaml(tmpDir, VALID_YAML)
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)

    expect(result).toHaveLength(2)
  })

  it('parses id, name, description correctly', async () => {
    await writeSkillsetsYaml(tmpDir, VALID_YAML)
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)

    const security = result.find((s) => s.id === 'security-review')
    expect(security).toBeDefined()
    expect(security!.name).toBe('Security Review Pack')
    expect(security!.description).toBe('OWASP checklist + dependency audit + secrets detection')
  })

  it('parses skillIds array correctly', async () => {
    await writeSkillsetsYaml(tmpDir, VALID_YAML)
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)

    const security = result.find((s) => s.id === 'security-review')
    expect(security!.skillIds).toEqual(['security-review', 'dependency-audit', 'secrets-hunt'])
  })

  it('parses contextBudgetPercent correctly', async () => {
    await writeSkillsetsYaml(tmpDir, VALID_YAML)
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)

    const security = result.find((s) => s.id === 'security-review')
    expect(security!.contextBudgetPercent).toBe(25)

    const testing = result.find((s) => s.id === 'testing')
    expect(testing!.contextBudgetPercent).toBe(15)
  })
})

describe('SkillSetLoader.load — built-in skillsets', () => {
  it('loads built-in skillsets when the workspace has no custom skillsets file', async () => {
    await writeBuiltinSkillsetsYaml(
      tmpDir,
      `skillsets:
  - id: plan-review
    name: Plan Review
    description: Built-in plan review skillset
    skills:
      - sequencing-check
    contextBudgetPercent: 30
`,
    )

    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('plan-review')
  })

  it('merges built-in and custom skillsets from separate files', async () => {
    await writeBuiltinSkillsetsYaml(
      tmpDir,
      `skillsets:
  - id: plan-review
    name: Plan Review
    description: Built-in plan review skillset
    skills:
      - sequencing-check
`,
    )
    await writeSkillsetsYaml(
      tmpDir,
      `skillsets:
  - id: custom-pack
    name: Custom Pack
    description: User-defined skillset
    skills:
      - custom-skill
`,
    )

    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)

    expect(result.map((skillset) => skillset.id).sort()).toEqual(['custom-pack', 'plan-review'])
  })
})

// ---------------------------------------------------------------------------
// Test 2: Missing YAML file → empty array (not an error)
// ---------------------------------------------------------------------------

describe('SkillSetLoader.load — missing file', () => {
  it('returns empty array when skillsets.yaml does not exist', async () => {
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)

    expect(result).toEqual([])
  })

  it('does not throw when skillsets.yaml is missing', async () => {
    const loader = new SkillSetLoader()
    await expect(loader.load(tmpDir)).resolves.not.toThrow()
  })

  it('does not log warnings for missing file', async () => {
    const warnSpy = vi.fn()
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })
    await loader.load(tmpDir)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Test 3: Invalid YAML → empty array with warning
// ---------------------------------------------------------------------------

describe('SkillSetLoader.load — invalid YAML', () => {
  it('returns empty array for invalid YAML', async () => {
    await writeSkillsetsYaml(tmpDir, '{ invalid yaml: [unclosed bracket')
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result).toEqual([])
  })

  it('logs a warning for invalid YAML', async () => {
    const warnSpy = vi.fn()
    await writeSkillsetsYaml(tmpDir, '{ invalid yaml: [unclosed bracket')
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })
    await loader.load(tmpDir)
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]![0]).toMatch(/invalid yaml/i)
  })

  it('returns empty array for an empty YAML file', async () => {
    await writeSkillsetsYaml(tmpDir, '')
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 4: Resolve skillset by ID → returns SkillSet with validated skills
// ---------------------------------------------------------------------------

describe('SkillSetLoader.resolve — valid resolution', () => {
  it('returns the skillset when all skill IDs are valid', () => {
    const loader = new SkillSetLoader()

    const skillSets = [makeSkillSet({ id: 'security-review', skillIds: ['sec', 'audit'] })]
    const loadedSkills = [makeSkill('sec'), makeSkill('audit')]

    const result = loader.resolve('security-review', skillSets, loadedSkills)

    expect(result).not.toBeNull()
    expect(result!.id).toBe('security-review')
    expect(result!.skillIds).toEqual(['sec', 'audit'])
  })

  it('preserves all skillset properties on resolution', () => {
    const loader = new SkillSetLoader()

    const skillSets = [
      makeSkillSet({
        id: 'my-set',
        name: 'My Set',
        description: 'Some description',
        skillIds: ['skill-a'],
        contextBudgetPercent: 30,
      }),
    ]
    const loadedSkills = [makeSkill('skill-a')]

    const result = loader.resolve('my-set', skillSets, loadedSkills)

    expect(result!.name).toBe('My Set')
    expect(result!.description).toBe('Some description')
    expect(result!.contextBudgetPercent).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Test 5: Resolve non-existent ID → returns null
// ---------------------------------------------------------------------------

describe('SkillSetLoader.resolve — non-existent ID', () => {
  it('returns null when skillset ID is not found', () => {
    const loader = new SkillSetLoader()
    const result = loader.resolve('nonexistent', [], [])
    expect(result).toBeNull()
  })

  it('returns null when skillSets array is empty', () => {
    const loader = new SkillSetLoader()
    const result = loader.resolve('some-id', [], [makeSkill('skill-a')])
    expect(result).toBeNull()
  })

  it('returns null for a partially matching ID', () => {
    const loader = new SkillSetLoader()
    const skillSets = [makeSkillSet({ id: 'security-review', skillIds: [] })]
    const result = loader.resolve('security', skillSets, [])
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Test 6: Resolve with missing skill references → warns, still returns skillset (with valid IDs only)
// ---------------------------------------------------------------------------

describe('SkillSetLoader.resolve — missing skill references', () => {
  it('warns for each missing skill reference', () => {
    const warnSpy = vi.fn()
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })

    const skillSets = [
      makeSkillSet({ id: 'my-set', skillIds: ['exists', 'missing-one', 'missing-two'] }),
    ]
    const loadedSkills = [makeSkill('exists')]

    loader.resolve('my-set', skillSets, loadedSkills)

    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy.mock.calls[0]![0]).toMatch(/missing-one/)
    expect(warnSpy.mock.calls[1]![0]).toMatch(/missing-two/)
  })

  it('still returns the skillset with only valid skill IDs', () => {
    const loader = new SkillSetLoader({ warn: vi.fn(), error: vi.fn() })

    const skillSets = [makeSkillSet({ id: 'mixed', skillIds: ['valid-skill', 'ghost-skill'] })]
    const loadedSkills = [makeSkill('valid-skill')]

    const result = loader.resolve('mixed', skillSets, loadedSkills)

    expect(result).not.toBeNull()
    expect(result!.skillIds).toEqual(['valid-skill'])
  })

  it('returns skillset with empty skillIds when all references are missing', () => {
    const warnSpy = vi.fn()
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })

    const skillSets = [makeSkillSet({ id: 'ghost-set', skillIds: ['ghost-a', 'ghost-b'] })]
    const loadedSkills: SkillDefinition[] = []

    const result = loader.resolve('ghost-set', skillSets, loadedSkills)

    expect(result).not.toBeNull()
    expect(result!.skillIds).toEqual([])
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Test 7: contextBudgetPercent validation (0-100, default 20)
// ---------------------------------------------------------------------------

describe('SkillSetLoader.load — contextBudgetPercent validation', () => {
  it('uses default 20 when contextBudgetPercent is not specified', async () => {
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: no-budget
    name: No Budget
    skills: []
`,
    )
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result[0]!.contextBudgetPercent).toBe(20)
  })

  it('accepts 0 as a valid contextBudgetPercent', async () => {
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: zero-budget
    name: Zero Budget
    skills: []
    contextBudgetPercent: 0
`,
    )
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result[0]!.contextBudgetPercent).toBe(0)
  })

  it('accepts 100 as a valid contextBudgetPercent', async () => {
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: full-budget
    name: Full Budget
    skills: []
    contextBudgetPercent: 100
`,
    )
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result[0]!.contextBudgetPercent).toBe(100)
  })

  it('uses default 20 and warns when contextBudgetPercent is out of range (>100)', async () => {
    const warnSpy = vi.fn()
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: over-budget
    name: Over Budget
    skills: []
    contextBudgetPercent: 150
`,
    )
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })
    const result = await loader.load(tmpDir)
    expect(result[0]!.contextBudgetPercent).toBe(20)
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]![0]).toMatch(/contextBudgetPercent/)
  })

  it('uses default 20 and warns when contextBudgetPercent is negative', async () => {
    const warnSpy = vi.fn()
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: neg-budget
    name: Neg Budget
    skills: []
    contextBudgetPercent: -5
`,
    )
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })
    const result = await loader.load(tmpDir)
    expect(result[0]!.contextBudgetPercent).toBe(20)
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('uses default 20 and warns when contextBudgetPercent is not a number', async () => {
    const warnSpy = vi.fn()
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: bad-budget
    name: Bad Budget
    skills: []
    contextBudgetPercent: "high"
`,
    )
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })
    const result = await loader.load(tmpDir)
    expect(result[0]!.contextBudgetPercent).toBe(20)
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Test 8: Empty skillsets array in YAML → empty array
// ---------------------------------------------------------------------------

describe('SkillSetLoader.load — empty skillsets array', () => {
  it('returns empty array when skillsets is an empty list', async () => {
    await writeSkillsetsYaml(tmpDir, 'skillsets: []')
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result).toEqual([])
  })

  it('returns empty array when skillsets key is missing', async () => {
    await writeSkillsetsYaml(tmpDir, 'other_key: value')
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 9: Skillset with all skill references valid
// ---------------------------------------------------------------------------

describe('SkillSetLoader.resolve — all references valid', () => {
  it('returns all skill IDs unchanged when every reference is valid', () => {
    const loader = new SkillSetLoader({ warn: vi.fn(), error: vi.fn() })

    const skillSets = [
      makeSkillSet({
        id: 'full-set',
        skillIds: ['skill-a', 'skill-b', 'skill-c'],
      }),
    ]
    const loadedSkills = [makeSkill('skill-a'), makeSkill('skill-b'), makeSkill('skill-c')]

    const result = loader.resolve('full-set', skillSets, loadedSkills)

    expect(result).not.toBeNull()
    expect(result!.skillIds).toEqual(['skill-a', 'skill-b', 'skill-c'])
  })

  it('does not log any warnings when all skill references are valid', () => {
    const warnSpy = vi.fn()
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })

    const skillSets = [makeSkillSet({ id: 'clean-set', skillIds: ['skill-x'] })]
    const loadedSkills = [makeSkill('skill-x')]

    loader.resolve('clean-set', skillSets, loadedSkills)

    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Test 10: Barrel export verification
// ---------------------------------------------------------------------------

describe('SkillSetLoader barrel export', () => {
  it('is exported from skills/index.ts', async () => {
    const module = await import('../index.js')
    expect(module.SkillSetLoader).toBeDefined()
    expect(typeof module.SkillSetLoader).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Additional edge case tests
// ---------------------------------------------------------------------------

describe('SkillSetLoader.load — edge cases', () => {
  it('skips skillset entries missing a valid id and warns', async () => {
    const warnSpy = vi.fn()
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - name: No ID Skillset
    skills: []
  - id: valid-id
    name: Valid
    skills: []
`,
    )
    const loader = new SkillSetLoader({ warn: warnSpy, error: vi.fn() })
    const result = await loader.load(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('valid-id')
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('uses id as fallback name when name is missing', async () => {
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: no-name
    skills: []
`,
    )
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result[0]!.name).toBe('no-name')
  })

  it('uses empty string as fallback description when missing', async () => {
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: no-desc
    name: No Desc
    skills: []
`,
    )
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result[0]!.description).toBe('')
  })

  it('handles missing skills field (uses empty skillIds)', async () => {
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: no-skills
    name: No Skills
`,
    )
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)
    expect(result[0]!.skillIds).toEqual([])
  })

  it('works without a logger (no errors thrown)', async () => {
    await writeSkillsetsYaml(tmpDir, VALID_YAML)
    const loader = new SkillSetLoader() // no logger
    await expect(loader.load(tmpDir)).resolves.not.toThrow()
  })

  it('loads the example from the task spec', async () => {
    await writeSkillsetsYaml(
      tmpDir,
      `
skillsets:
  - id: security-review
    name: Security Review Pack
    description: OWASP checklist + dependency audit + secrets detection
    skills:
      - security-review
      - dependency-audit
      - secrets-hunt
    contextBudgetPercent: 25

  - id: testing
    name: Testing Pack
    description: Test generation and quality checks
    skills:
      - test-generator
      - coverage-check
    contextBudgetPercent: 15
`,
    )
    const loader = new SkillSetLoader()
    const result = await loader.load(tmpDir)

    expect(result).toHaveLength(2)

    const security = result.find((s) => s.id === 'security-review')!
    expect(security.name).toBe('Security Review Pack')
    expect(security.skillIds).toEqual(['security-review', 'dependency-audit', 'secrets-hunt'])
    expect(security.contextBudgetPercent).toBe(25)

    const testing = result.find((s) => s.id === 'testing')!
    expect(testing.name).toBe('Testing Pack')
    expect(testing.skillIds).toEqual(['test-generator', 'coverage-check'])
    expect(testing.contextBudgetPercent).toBe(15)
  })
})
