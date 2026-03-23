import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProgram } from '../program.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ao-init-'))
  vi.restoreAllMocks()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function captureConsole(): { output: string[]; restore: () => void } {
  const output: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(' '))
  })
  return {
    output,
    restore: () => {
      vi.restoreAllMocks()
    },
  }
}

async function runInit(args: string[] = []): Promise<string[]> {
  const { output, restore } = captureConsole()
  const program = createProgram()
  program.exitOverride()

  await program.parseAsync(['node', 'agent-orchestra', 'init', '--path', tempDir, ...args])

  restore()
  return output
}

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------

describe('init command — registration', () => {
  it('program has init command registered', () => {
    const program = createProgram()
    const init = program.commands.find((c) => c.name() === 'init')
    expect(init).toBeDefined()
  })

  it('init command has expected options', () => {
    const program = createProgram()
    const init = program.commands.find((c) => c.name() === 'init')!
    const optionLongs = init.options.map((o) => o.long)
    expect(optionLongs).toContain('--path')
    expect(optionLongs).toContain('--yes')
    expect(optionLongs).toContain('--project-type')
    expect(optionLongs).toContain('--with-policy')
    expect(optionLongs).toContain('--with-skillsets')
    expect(optionLongs).toContain('--refresh-agents')
    expect(optionLongs).toContain('--force')
  })
})

// ---------------------------------------------------------------------------
// Basic init execution
// ---------------------------------------------------------------------------

describe('init command — basic execution', () => {
  it('creates AGENTS.md in an empty directory', async () => {
    await runInit()

    const agentsMd = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8')
    expect(agentsMd).toContain('Agent Orchestra')
    expect(agentsMd).toContain('agent-orchestra run')
  })

  it('detects generic project type in empty directory', async () => {
    const output = await runInit()
    const combined = output.join('\n')
    expect(combined).toContain('Detected project: generic')
  })

  it('detects node-ts from package.json', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}')

    const output = await runInit()
    const combined = output.join('\n')
    expect(combined).toContain('Detected project: node-ts')
  })

  it('prints recommended superpowers', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}')

    const output = await runInit()
    const combined = output.join('\n')
    expect(combined).toContain('Recommended superpowers:')
    expect(combined).toContain('security-review')
  })

  it('prints generated file list', async () => {
    const output = await runInit()
    const combined = output.join('\n')
    expect(combined).toContain('Generated:')
    expect(combined).toContain('AGENTS.md')
  })

  it('creates .agent-orchestra/ directory', async () => {
    await runInit()

    const { stat: fsStat } = await import('node:fs/promises')
    const info = await fsStat(join(tempDir, '.agent-orchestra'))
    expect(info.isDirectory()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Safe behavior with existing files
// ---------------------------------------------------------------------------

describe('init command — safe behavior', () => {
  it('refreshes agents.yaml when --refresh-agents is passed', async () => {
    await mkdir(join(tempDir, '.agent-orchestra'), { recursive: true })
    await writeFile(
      join(tempDir, '.agent-orchestra', 'agents.yaml'),
      `architect:\n  provider: codex-cli\n  model: o4-mini\n\nreviewer:\n  provider: codex-cli\n  model: o4-mini\n`,
    )

    await runInit(['--refresh-agents'])

    const content = await readFile(join(tempDir, '.agent-orchestra', 'agents.yaml'), 'utf-8')
    expect(content).toContain('model: gpt-5.4')
    expect(content).not.toContain('model: o4-mini')
  })

  it('keeps existing agents.yaml by default and hints about --refresh-agents', async () => {
    await mkdir(join(tempDir, '.agent-orchestra'), { recursive: true })
    const originalContent = `architect:\n  provider: codex-cli\n  model: o4-mini\n\nreviewer:\n  provider: codex-cli\n  model: o4-mini\n`
    await writeFile(join(tempDir, '.agent-orchestra', 'agents.yaml'), originalContent)

    const output = await runInit()
    const combined = output.join('\n')
    const content = await readFile(join(tempDir, '.agent-orchestra', 'agents.yaml'), 'utf-8')

    expect(content).toBe(originalContent)
    expect(combined).toContain('--refresh-agents')
  })

  it('does not overwrite existing AGENTS.md without --force', async () => {
    const originalContent = '# My Existing Agents\n\nCustom instructions here.'
    await writeFile(join(tempDir, 'AGENTS.md'), originalContent)

    await runInit()

    const content = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8')
    // Should append, not overwrite
    expect(content).toContain('Custom instructions here.')
    expect(content).toContain('Agent Orchestra')
  })

  it('skips AGENTS.md if it already contains Agent Orchestra content', async () => {
    const existingContent = '# Agents\n\nUse Agent Orchestra for reviews.'
    await writeFile(join(tempDir, 'AGENTS.md'), existingContent)

    const output = await runInit()
    const combined = output.join('\n')
    expect(combined).toContain('Skipped')
    expect(combined).toContain('already contains')
  })

  it('--force overwrites existing AGENTS.md', async () => {
    const originalContent = '# Old content that should be replaced'
    await writeFile(join(tempDir, 'AGENTS.md'), originalContent)

    await runInit(['--force'])

    const content = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8')
    expect(content).not.toContain('Old content')
    expect(content).toContain('Agent Instructions')
  })
})

// ---------------------------------------------------------------------------
// Optional file generation
// ---------------------------------------------------------------------------

describe('init command — optional files', () => {
  it('bootstraps built-in skills and skillsets by default for superpower runs', async () => {
    await runInit()

    const sequencingSkill = await readFile(
      join(tempDir, '.agent-orchestra', 'skills', 'sequencing-check', 'SKILL.md'),
      'utf-8',
    )
    const securitySkill = await readFile(
      join(tempDir, '.agent-orchestra', 'skills', 'security-review', 'SKILL.md'),
      'utf-8',
    )
    const builtinSkillsets = await readFile(
      join(tempDir, '.agent-orchestra', 'skillsets.builtin.yaml'),
      'utf-8',
    )

    expect(sequencingSkill).toContain('name: Sequencing Check')
    expect(securitySkill).toContain('name: Security Review')
    expect(builtinSkillsets).toContain('id: plan-review')
    expect(builtinSkillsets).toContain('id: security-review')
  })

  it('--with-policy generates policy.yaml', async () => {
    await runInit(['--with-policy'])

    const policy = await readFile(join(tempDir, '.agent-orchestra', 'policy.yaml'), 'utf-8')
    expect(policy).toContain('defaultAction: deny')
  })

  it('--with-skillsets generates skillsets.yaml', async () => {
    await runInit(['--with-skillsets'])

    const skillsets = await readFile(join(tempDir, '.agent-orchestra', 'skillsets.yaml'), 'utf-8')
    expect(skillsets).toContain('skillsets:')
  })

  it('does not generate policy.yaml by default', async () => {
    await runInit()

    const { stat: fsStat } = await import('node:fs/promises')
    try {
      await fsStat(join(tempDir, '.agent-orchestra', 'policy.yaml'))
      expect.fail('policy.yaml should not exist')
    } catch {
      // Expected — file should not exist
    }
  })

  it('does not overwrite existing policy.yaml without --force', async () => {
    await mkdir(join(tempDir, '.agent-orchestra'), { recursive: true })
    const original = '# existing policy'
    await writeFile(join(tempDir, '.agent-orchestra', 'policy.yaml'), original)

    const output = await runInit(['--with-policy'])
    const combined = output.join('\n')
    expect(combined).toContain('Skipped')

    const content = await readFile(join(tempDir, '.agent-orchestra', 'policy.yaml'), 'utf-8')
    expect(content).toBe(original)
  })
})

// ---------------------------------------------------------------------------
// No-op behavior
// ---------------------------------------------------------------------------

describe('init command — no-op when files exist', () => {
  it('reports nothing to generate when all files exist', async () => {
    // Create AGENTS.md with Agent Orchestra content
    await writeFile(join(tempDir, 'AGENTS.md'), '# Uses Agent Orchestra\n')
    // Create agents.yaml so provider detection doesn't generate it
    await mkdir(join(tempDir, '.agent-orchestra'), { recursive: true })
    await writeFile(join(tempDir, '.agent-orchestra', 'agents.yaml'), '# existing\n')

    const output = await runInit()
    const combined = output.join('\n')
    expect(combined).toContain('Skipped')
  })
})

// ---------------------------------------------------------------------------
// Project type override
// ---------------------------------------------------------------------------

describe('init command — project type override', () => {
  it('--project-type overrides detection', async () => {
    // Empty dir would detect generic, but we override
    const output = await runInit(['--project-type', 'python'])
    const combined = output.join('\n')
    expect(combined).toContain('Detected project: python')
  })
})
