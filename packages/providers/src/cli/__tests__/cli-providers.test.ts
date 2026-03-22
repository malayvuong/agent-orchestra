import { describe, it, expect } from 'vitest'
import { ClaudeCliProvider } from '../claude-cli.js'
import { CodexCliProvider } from '../codex-cli.js'
import { detectCliProviders, isCommandAvailable } from '../detect.js'
import { ProviderError } from '../../types.js'

// ---------------------------------------------------------------------------
// ClaudeCliProvider — construction
// ---------------------------------------------------------------------------

describe('ClaudeCliProvider', () => {
  it('can be constructed with default config', () => {
    const provider = new ClaudeCliProvider()
    expect(provider).toBeDefined()
  })

  it('can be constructed with custom config', () => {
    const provider = new ClaudeCliProvider({
      command: '/usr/local/bin/claude',
      defaultModel: 'opus',
    })
    expect(provider).toBeDefined()
  })

  it('implements the run method', () => {
    const provider = new ClaudeCliProvider()
    expect(typeof provider.run).toBe('function')
  })

  it('throws ProviderError with ENOENT when command not found', async () => {
    const provider = new ClaudeCliProvider({
      command: 'nonexistent-claude-binary-xyz',
    })

    await expect(
      provider.run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'sonnet',
      }),
    ).rejects.toThrow(ProviderError)

    try {
      await provider.run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'sonnet',
      })
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).code).toBe('auth_error')
      expect((err as ProviderError).message).toContain('not found')
    }
  })
})

// ---------------------------------------------------------------------------
// CodexCliProvider — construction
// ---------------------------------------------------------------------------

describe('CodexCliProvider', () => {
  it('can be constructed with default config', () => {
    const provider = new CodexCliProvider()
    expect(provider).toBeDefined()
  })

  it('can be constructed with custom config', () => {
    const provider = new CodexCliProvider({
      command: '/usr/local/bin/codex',
      defaultModel: 'gpt-4o',
    })
    expect(provider).toBeDefined()
  })

  it('implements the run method', () => {
    const provider = new CodexCliProvider()
    expect(typeof provider.run).toBe('function')
  })

  it('throws ProviderError with ENOENT when command not found', async () => {
    const provider = new CodexCliProvider({
      command: 'nonexistent-codex-binary-xyz',
    })

    await expect(
      provider.run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'o4-mini',
      }),
    ).rejects.toThrow(ProviderError)

    try {
      await provider.run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'o4-mini',
      })
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).code).toBe('auth_error')
      expect((err as ProviderError).message).toContain('not found')
    }
  })
})

// ---------------------------------------------------------------------------
// isCommandAvailable
// ---------------------------------------------------------------------------

describe('isCommandAvailable', () => {
  it('returns true for a command that exists (node)', async () => {
    const result = await isCommandAvailable('node')
    expect(result).toBe(true)
  })

  it('returns false for a command that does not exist', async () => {
    const result = await isCommandAvailable('definitely-not-a-real-command-xyz-123')
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// detectCliProviders
// ---------------------------------------------------------------------------

describe('detectCliProviders', () => {
  it('returns a detection result object', async () => {
    const result = await detectCliProviders()
    expect(result).toBeDefined()
    expect(typeof result.claudeCli).toBe('boolean')
    expect(typeof result.codexCli).toBe('boolean')
    // preferred is either a string or null
    expect(result.preferred === null || typeof result.preferred === 'string').toBe(true)
  })

  it('preferred is claude-cli when claude is available', async () => {
    const result = await detectCliProviders()
    if (result.claudeCli) {
      expect(result.preferred).toBe('claude-cli')
    }
  })

  it('preferred is codex-cli when only codex is available', async () => {
    const result = await detectCliProviders()
    if (!result.claudeCli && result.codexCli) {
      expect(result.preferred).toBe('codex-cli')
    }
  })

  it('preferred is null when neither is available', async () => {
    const result = await detectCliProviders()
    if (!result.claudeCli && !result.codexCli) {
      expect(result.preferred).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// Provider interface compliance
// ---------------------------------------------------------------------------

describe('CLI providers — interface compliance', () => {
  it('ClaudeCliProvider has same interface as API providers', () => {
    const provider = new ClaudeCliProvider()
    // Must have run() that accepts ProviderInput and returns Promise<ProviderOutput>
    expect(typeof provider.run).toBe('function')
  })

  it('CodexCliProvider has same interface as API providers', () => {
    const provider = new CodexCliProvider()
    expect(typeof provider.run).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Integration with echo (simulates CLI tool output)
// ---------------------------------------------------------------------------

describe('ClaudeCliProvider — echo integration', () => {
  it('captures stdout from a real subprocess', async () => {
    // Use echo as a stand-in for the claude CLI to test process spawning
    const provider = new ClaudeCliProvider({ command: 'echo' })

    const result = await provider.run({
      systemPrompt: 'system',
      userPrompt: 'user prompt',
      model: 'test',
    })

    // echo will print the -p flag value
    expect(result.rawText).toBeTruthy()
    expect(result.exitCode).toBe(0)
    expect(result.usage?.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

describe('CodexCliProvider — echo integration', () => {
  it('captures stdout from a real subprocess', async () => {
    const provider = new CodexCliProvider({ command: 'echo' })

    const result = await provider.run({
      systemPrompt: 'system',
      userPrompt: 'user prompt',
      model: 'test',
    })

    expect(result.rawText).toBeTruthy()
    expect(result.exitCode).toBe(0)
  })
})
