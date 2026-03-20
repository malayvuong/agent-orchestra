import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillLoader } from '../loader.js'
import { SkillParser } from '../parser.js'
import type { SkillDefinition, SkillParseError } from '../types.js'
import type { TokenEstimator } from '../../interfaces/token-estimator.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEstimator(): TokenEstimator {
  return { estimate: (text: string) => Math.ceil(text.length * 0.25) }
}

function makeParser(): SkillParser {
  return new SkillParser(makeEstimator())
}

/** Minimal valid SKILL.md content */
function minimalSkillMd(name: string, description = 'A test skill'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nSkill body for ${name}.`
}

/** Create a skill directory with a SKILL.md inside it */
async function createSkillDir(basePath: string, dirName: string, content: string): Promise<string> {
  const skillDir = join(basePath, dirName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), content, 'utf-8')
  return skillDir
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'loader-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// discoverSkillDirs
// ---------------------------------------------------------------------------

describe('SkillLoader.discoverSkillDirs', () => {
  it('returns paths to directories containing SKILL.md', async () => {
    const skillsBase = join(tmpDir, 'skills')
    await mkdir(skillsBase)
    await createSkillDir(skillsBase, 'my-skill', minimalSkillMd('my-skill'))
    await createSkillDir(skillsBase, 'another-skill', minimalSkillMd('another-skill'))

    const loader = new SkillLoader(makeParser())
    const dirs = await loader.discoverSkillDirs(skillsBase)

    expect(dirs).toHaveLength(2)
    expect(dirs).toContain(join(skillsBase, 'my-skill'))
    expect(dirs).toContain(join(skillsBase, 'another-skill'))
  })

  it('ignores directories without SKILL.md', async () => {
    const skillsBase = join(tmpDir, 'skills')
    await mkdir(skillsBase)
    // Valid skill dir
    await createSkillDir(skillsBase, 'valid-skill', minimalSkillMd('valid-skill'))
    // Dir without SKILL.md
    await mkdir(join(skillsBase, 'no-skill-file'))

    const loader = new SkillLoader(makeParser())
    const dirs = await loader.discoverSkillDirs(skillsBase)

    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toBe(join(skillsBase, 'valid-skill'))
  })

  it('ignores regular files in the base directory', async () => {
    const skillsBase = join(tmpDir, 'skills')
    await mkdir(skillsBase)
    await createSkillDir(skillsBase, 'valid-skill', minimalSkillMd('valid-skill'))
    // Place a regular file (not a directory)
    await writeFile(join(skillsBase, 'SKILL.md'), minimalSkillMd('orphan'), 'utf-8')

    const loader = new SkillLoader(makeParser())
    const dirs = await loader.discoverSkillDirs(skillsBase)

    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toBe(join(skillsBase, 'valid-skill'))
  })

  it('returns empty array when base path does not exist', async () => {
    const loader = new SkillLoader(makeParser())
    const dirs = await loader.discoverSkillDirs(join(tmpDir, 'nonexistent'))
    expect(dirs).toHaveLength(0)
  })

  it('returns empty array for an empty directory', async () => {
    const skillsBase = join(tmpDir, 'empty-skills')
    await mkdir(skillsBase)

    const loader = new SkillLoader(makeParser())
    const dirs = await loader.discoverSkillDirs(skillsBase)
    expect(dirs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// loadFromDirectory
// ---------------------------------------------------------------------------

describe('SkillLoader.loadFromDirectory', () => {
  it('loads a single skill from a directory', async () => {
    const skillDir = await createSkillDir(tmpDir, 'my-skill', minimalSkillMd('My Skill'))

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromDirectory(skillDir)

    expect(isParseError(result)).toBe(false)
    const skill = result as SkillDefinition
    // ID should be overridden by directory name
    expect(skill.id).toBe('my-skill')
    expect(skill.name).toBe('My Skill')
    expect(skill.skillType).toBe('prompt')
  })

  it('overrides skill ID with directory name (not frontmatter name)', async () => {
    // Frontmatter name would produce id "front-matter-name"
    // Directory name is "dir-name" → should be used as ID
    const skillDir = await createSkillDir(tmpDir, 'dir-name', minimalSkillMd('front-matter-name'))

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromDirectory(skillDir)

    expect(isParseError(result)).toBe(false)
    const skill = result as SkillDefinition
    expect(skill.id).toBe('dir-name')
  })

  it('returns parse_error when SKILL.md does not exist', async () => {
    const emptyDir = join(tmpDir, 'empty-skill-dir')
    await mkdir(emptyDir)

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromDirectory(emptyDir)

    expect(isParseError(result)).toBe(true)
    const err = result as SkillParseError
    expect(err.type).toBe('parse_error')
  })

  it('returns parse_error for invalid SKILL.md content', async () => {
    const skillDir = join(tmpDir, 'bad-skill')
    await mkdir(skillDir)
    // Write content without frontmatter
    await writeFile(join(skillDir, 'SKILL.md'), 'No frontmatter here', 'utf-8')

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromDirectory(skillDir)

    expect(isParseError(result)).toBe(true)
    const err = result as SkillParseError
    expect(err.type).toBe('parse_error')
    expect(err.message).toMatch(/frontmatter/i)
  })

  it('returns parse_error when directory name contains invalid characters', async () => {
    // Create a directory with uppercase letters (invalid ID: must be [a-z0-9-]+)
    const skillDir = await createSkillDir(tmpDir, 'Invalid_Name', minimalSkillMd('Some Skill'))

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromDirectory(skillDir)

    expect(isParseError(result)).toBe(true)
    const err = result as SkillParseError
    expect(err.type).toBe('parse_error')
    expect(err.message).toMatch(/invalid skill id/i)
  })

  it('sets source.path to the SKILL.md file path', async () => {
    const skillDir = await createSkillDir(tmpDir, 'path-test', minimalSkillMd('Path Test'))

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromDirectory(skillDir)

    expect(isParseError(result)).toBe(false)
    const skill = result as SkillDefinition
    expect(skill.source).toEqual({ type: 'local', path: join(skillDir, 'SKILL.md') })
  })
})

// ---------------------------------------------------------------------------
// loadFromWorkspace — .agent-orchestra/skills/
// ---------------------------------------------------------------------------

describe('SkillLoader.loadFromWorkspace — .agent-orchestra/skills/', () => {
  it('loads skills from .agent-orchestra/skills/', async () => {
    const skillsBase = join(tmpDir, '.agent-orchestra', 'skills')
    await createSkillDir(skillsBase, 'security-review', minimalSkillMd('Security Review'))
    await createSkillDir(skillsBase, 'code-quality', minimalSkillMd('Code Quality'))

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromWorkspace(tmpDir)

    expect(result.errors).toHaveLength(0)
    expect(result.skills).toHaveLength(2)
    const ids = result.skills.map((s) => s.id)
    expect(ids).toContain('security-review')
    expect(ids).toContain('code-quality')
  })

  it('returns empty skills and no errors when .agent-orchestra/skills/ does not exist', async () => {
    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromWorkspace(tmpDir)

    expect(result.skills).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// loadFromWorkspace — .agents/skills/
// ---------------------------------------------------------------------------

describe('SkillLoader.loadFromWorkspace — .agents/skills/', () => {
  it('loads skills from .agents/skills/', async () => {
    const skillsBase = join(tmpDir, '.agents', 'skills')
    await createSkillDir(skillsBase, 'dependency-check', minimalSkillMd('Dependency Check'))

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromWorkspace(tmpDir)

    expect(result.errors).toHaveLength(0)
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]!.id).toBe('dependency-check')
  })
})

// ---------------------------------------------------------------------------
// loadFromWorkspace — priority: project-level overrides user-level
// ---------------------------------------------------------------------------

describe('SkillLoader.loadFromWorkspace — priority / deduplication', () => {
  it('project-level skill overrides user-level skill with same ID', async () => {
    const projectSkillsBase = join(tmpDir, '.agent-orchestra', 'skills')
    await createSkillDir(
      projectSkillsBase,
      'shared-skill',
      minimalSkillMd('Project Version', 'Project-level description'),
    )

    // We can't easily override home dir in tests, so test .agent-orchestra vs .agents priority
    // .agent-orchestra (priority 0) overrides .agents (priority 1)
    const agentsSkillsBase = join(tmpDir, '.agents', 'skills')
    await createSkillDir(
      agentsSkillsBase,
      'shared-skill',
      minimalSkillMd('Agents Version', 'Agents-level description'),
    )

    const warnMsgs: string[] = []
    const logger = {
      warn: (msg: string) => warnMsgs.push(msg),
      error: vi.fn(),
    }
    const loader = new SkillLoader(makeParser(), logger)
    const result = await loader.loadFromWorkspace(tmpDir)

    expect(result.errors).toHaveLength(0)
    // Only one "shared-skill" in results (no duplicates)
    const sharedSkills = result.skills.filter((s) => s.id === 'shared-skill')
    expect(sharedSkills).toHaveLength(1)
    // The project-level (.agent-orchestra) description wins
    expect(sharedSkills[0]!.description).toBe('Project-level description')
    // A warning about duplicate was logged
    expect(warnMsgs.some((m) => m.includes('shared-skill'))).toBe(true)
  })

  it('loads skills from both .agent-orchestra and .agents when no conflicts', async () => {
    const projectBase = join(tmpDir, '.agent-orchestra', 'skills')
    await createSkillDir(projectBase, 'project-skill', minimalSkillMd('Project Skill'))

    const agentsBase = join(tmpDir, '.agents', 'skills')
    await createSkillDir(agentsBase, 'agents-skill', minimalSkillMd('Agents Skill'))

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromWorkspace(tmpDir)

    expect(result.errors).toHaveLength(0)
    expect(result.skills).toHaveLength(2)
    const ids = result.skills.map((s) => s.id)
    expect(ids).toContain('project-skill')
    expect(ids).toContain('agents-skill')
  })
})

// ---------------------------------------------------------------------------
// loadFromWorkspace — error handling
// ---------------------------------------------------------------------------

describe('SkillLoader.loadFromWorkspace — error handling', () => {
  it('continues loading other skills when one fails to parse', async () => {
    const skillsBase = join(tmpDir, '.agent-orchestra', 'skills')

    // Valid skill
    await createSkillDir(skillsBase, 'good-skill', minimalSkillMd('Good Skill'))

    // Bad skill (no frontmatter)
    const badSkillDir = join(skillsBase, 'bad-skill')
    await mkdir(badSkillDir, { recursive: true })
    await writeFile(join(badSkillDir, 'SKILL.md'), 'No frontmatter at all', 'utf-8')

    // Another valid skill
    await createSkillDir(skillsBase, 'another-good-skill', minimalSkillMd('Another Good'))

    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromWorkspace(tmpDir)

    // Two valid skills loaded
    expect(result.skills).toHaveLength(2)
    const ids = result.skills.map((s) => s.id)
    expect(ids).toContain('good-skill')
    expect(ids).toContain('another-good-skill')

    // One error recorded for the bad skill
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.path).toBe(badSkillDir)
  })

  it('returns empty result when all skill directories are missing', async () => {
    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromWorkspace(join(tmpDir, 'workspace-without-skills'))

    expect(result.skills).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('logs errors when skills fail to parse', async () => {
    const skillsBase = join(tmpDir, '.agent-orchestra', 'skills')
    const badSkillDir = join(skillsBase, 'broken-skill')
    await mkdir(badSkillDir, { recursive: true })
    await writeFile(join(badSkillDir, 'SKILL.md'), 'Not valid SKILL.md content', 'utf-8')

    const errorMsgs: string[] = []
    const logger = {
      warn: vi.fn(),
      error: (msg: string) => errorMsgs.push(msg),
    }

    const loader = new SkillLoader(makeParser(), logger)
    await loader.loadFromWorkspace(tmpDir)

    expect(errorMsgs.length).toBeGreaterThan(0)
    expect(errorMsgs.some((m) => m.includes('broken-skill'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cache behavior
// ---------------------------------------------------------------------------

describe('SkillLoader cache', () => {
  it('getCache() returns empty array before any load', () => {
    const loader = new SkillLoader(makeParser())
    expect(loader.getCache()).toHaveLength(0)
  })

  it('getCache() returns loaded skills after loadFromWorkspace', async () => {
    const skillsBase = join(tmpDir, '.agent-orchestra', 'skills')
    await createSkillDir(skillsBase, 'cached-skill', minimalSkillMd('Cached Skill'))

    const loader = new SkillLoader(makeParser())
    await loader.loadFromWorkspace(tmpDir)

    const cached = loader.getCache()
    expect(cached).toHaveLength(1)
    expect(cached[0]!.id).toBe('cached-skill')
  })

  it('clearCache() empties the cache', async () => {
    const skillsBase = join(tmpDir, '.agent-orchestra', 'skills')
    await createSkillDir(skillsBase, 'cached-skill', minimalSkillMd('Cached Skill'))

    const loader = new SkillLoader(makeParser())
    await loader.loadFromWorkspace(tmpDir)

    expect(loader.getCache()).toHaveLength(1)

    loader.clearCache()
    expect(loader.getCache()).toHaveLength(0)
  })

  it('cache accumulates skills across multiple loadFromWorkspace calls', async () => {
    const skillsBase = join(tmpDir, '.agent-orchestra', 'skills')
    await createSkillDir(skillsBase, 'skill-one', minimalSkillMd('Skill One'))

    const loader = new SkillLoader(makeParser())
    await loader.loadFromWorkspace(tmpDir)

    // Add a second skill and load again
    await createSkillDir(skillsBase, 'skill-two', minimalSkillMd('Skill Two'))
    await loader.loadFromWorkspace(tmpDir)

    // Cache should have both skills
    const cached = loader.getCache()
    const ids = cached.map((s) => s.id)
    expect(ids).toContain('skill-one')
    expect(ids).toContain('skill-two')
  })

  it('cache is keyed by skill ID, so duplicate IDs overwrite', async () => {
    const skillsBase = join(tmpDir, '.agent-orchestra', 'skills')
    await createSkillDir(skillsBase, 'my-skill', minimalSkillMd('My Skill V1', 'Version 1'))

    const loader = new SkillLoader(makeParser())
    await loader.loadFromWorkspace(tmpDir)
    expect(loader.getCache()[0]!.description).toBe('Version 1')

    loader.clearCache()

    // Update the skill content and reload
    const skillDir = join(skillsBase, 'my-skill')
    await writeFile(join(skillDir, 'SKILL.md'), minimalSkillMd('My Skill V2', 'Version 2'), 'utf-8')
    await loader.loadFromWorkspace(tmpDir)

    const cached = loader.getCache()
    expect(cached).toHaveLength(1)
    expect(cached[0]!.description).toBe('Version 2')
  })
})

// ---------------------------------------------------------------------------
// Barrel export
// ---------------------------------------------------------------------------

describe('SkillLoader barrel export', () => {
  it('is exported from skills/index.ts', async () => {
    const module = await import('../index.js')
    expect(module.SkillLoader).toBeDefined()
    expect(typeof module.SkillLoader).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// SkillLoader constructor — optional logger
// ---------------------------------------------------------------------------

describe('SkillLoader — logger behavior', () => {
  it('works without a logger (no errors thrown)', async () => {
    const skillsBase = join(tmpDir, '.agent-orchestra', 'skills')
    await createSkillDir(skillsBase, 'silent-skill', minimalSkillMd('Silent Skill'))

    // No logger passed
    const loader = new SkillLoader(makeParser())
    const result = await loader.loadFromWorkspace(tmpDir)

    expect(result.skills).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })

  it('calls logger.warn for duplicate skill IDs', async () => {
    const warnCalls: string[] = []
    const logger = {
      warn: (msg: string) => warnCalls.push(msg),
      error: vi.fn(),
    }

    const projectBase = join(tmpDir, '.agent-orchestra', 'skills')
    const agentsBase = join(tmpDir, '.agents', 'skills')
    await createSkillDir(projectBase, 'dup-skill', minimalSkillMd('Dup Skill A'))
    await createSkillDir(agentsBase, 'dup-skill', minimalSkillMd('Dup Skill B'))

    const loader = new SkillLoader(makeParser(), logger)
    await loader.loadFromWorkspace(tmpDir)

    expect(warnCalls.some((m) => m.includes('dup-skill'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Internal helper — isParseError
// ---------------------------------------------------------------------------

function isParseError(result: SkillDefinition | SkillParseError): result is SkillParseError {
  return (
    result !== null &&
    typeof result === 'object' &&
    'type' in result &&
    (result as SkillParseError).type === 'parse_error'
  )
}
