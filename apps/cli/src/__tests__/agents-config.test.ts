import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadAgentsConfig } from '../init/agents-config.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ao-agents-'))
  await mkdir(join(tempDir, '.agent-orchestra'), { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Missing config
// ---------------------------------------------------------------------------

describe('loadAgentsConfig — missing file', () => {
  it('returns null when agents.yaml does not exist', async () => {
    const config = await loadAgentsConfig(tempDir)
    expect(config).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Architect config
// ---------------------------------------------------------------------------

describe('loadAgentsConfig — architect', () => {
  it('parses architect provider and model', async () => {
    await writeFile(
      join(tempDir, '.agent-orchestra', 'agents.yaml'),
      `architect:\n  provider: codex-cli\n  model: o4-mini\n`,
    )

    const config = await loadAgentsConfig(tempDir)
    expect(config).not.toBeNull()
    expect(config!.architect?.provider).toBe('codex-cli')
    expect(config!.architect?.model).toBe('o4-mini')
  })

  it('handles architect without model', async () => {
    await writeFile(
      join(tempDir, '.agent-orchestra', 'agents.yaml'),
      `architect:\n  provider: claude-cli\n`,
    )

    const config = await loadAgentsConfig(tempDir)
    expect(config!.architect?.provider).toBe('claude-cli')
    expect(config!.architect?.model).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Reviewer config — single shorthand
// ---------------------------------------------------------------------------

describe('loadAgentsConfig — single reviewer', () => {
  it('parses reviewer shorthand (singular key)', async () => {
    await writeFile(
      join(tempDir, '.agent-orchestra', 'agents.yaml'),
      `reviewer:\n  provider: claude-cli\n  model: sonnet\n  lens: security\n`,
    )

    const config = await loadAgentsConfig(tempDir)
    expect(config!.reviewers).toHaveLength(1)
    expect(config!.reviewers![0].provider).toBe('claude-cli')
    expect(config!.reviewers![0].model).toBe('sonnet')
    expect(config!.reviewers![0].lens).toBe('security')
  })
})

// ---------------------------------------------------------------------------
// Reviewer config — multiple reviewers
// ---------------------------------------------------------------------------

describe('loadAgentsConfig — multiple reviewers', () => {
  it('parses reviewers array', async () => {
    await writeFile(
      join(tempDir, '.agent-orchestra', 'agents.yaml'),
      `reviewers:
  - provider: claude-cli
    model: sonnet
    lens: security
  - provider: grok
    model: grok-3
    lens: scope
  - provider: deepseek
    model: deepseek-chat
    lens: risk
`,
    )

    const config = await loadAgentsConfig(tempDir)
    expect(config!.reviewers).toHaveLength(3)
    expect(config!.reviewers![0].provider).toBe('claude-cli')
    expect(config!.reviewers![1].provider).toBe('grok')
    expect(config!.reviewers![2].provider).toBe('deepseek')
  })
})

// ---------------------------------------------------------------------------
// Full config
// ---------------------------------------------------------------------------

describe('loadAgentsConfig — full config', () => {
  it('parses architect + reviewers together', async () => {
    await writeFile(
      join(tempDir, '.agent-orchestra', 'agents.yaml'),
      `architect:
  provider: codex-cli
  model: o4-mini

reviewers:
  - provider: claude-cli
    model: sonnet
    lens: security
  - provider: grok
    model: grok-3
    lens: scope
`,
    )

    const config = await loadAgentsConfig(tempDir)
    expect(config!.architect?.provider).toBe('codex-cli')
    expect(config!.reviewers).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Invalid config
// ---------------------------------------------------------------------------

describe('loadAgentsConfig — invalid', () => {
  it('returns null for invalid YAML', async () => {
    await writeFile(join(tempDir, '.agent-orchestra', 'agents.yaml'), `{{{invalid yaml!!!`)

    const config = await loadAgentsConfig(tempDir)
    expect(config).toBeNull()
  })

  it('returns empty config for empty file', async () => {
    await writeFile(join(tempDir, '.agent-orchestra', 'agents.yaml'), ``)

    const config = await loadAgentsConfig(tempDir)
    expect(config).toBeNull()
  })
})
