import { describe, it, expect } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
        model: 'claude-opus-4-6',
      }),
    ).rejects.toThrow(ProviderError)

    try {
      await provider.run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'claude-opus-4-6',
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
      defaultModel: 'gpt-5.4',
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
        model: 'gpt-5.4',
      }),
    ).rejects.toThrow(ProviderError)

    try {
      await provider.run({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'gpt-5.4',
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

  it('does not surface EPIPE when the child closes stdin early', async () => {
    const scriptDir = await mkdtemp(join(tmpdir(), 'ao-claude-cli-test-'))
    const scriptPath = join(scriptDir, 'close-stdin.sh')

    try {
      await writeFile(
        scriptPath,
        ['#!/bin/sh', 'exec 0<&-', 'sleep 0.1', 'exit 0', ''].join('\n'),
        'utf-8',
      )
      await chmod(scriptPath, 0o755)

      const provider = new ClaudeCliProvider({ command: scriptPath })
      const largePrompt = 'x'.repeat(2_000_000)
      const result = await provider.run({
        systemPrompt: largePrompt,
        userPrompt: largePrompt,
        model: 'test',
      })

      expect(result.rawText).toBe('')
      expect(result.exitCode).toBe(0)
    } finally {
      await rm(scriptDir, { recursive: true, force: true })
    }
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

  it('uses codex exec with stdin prompt delivery and GPT-5.4 as the default model', async () => {
    const scriptDir = await mkdtemp(join(tmpdir(), 'ao-codex-cli-test-'))
    const scriptPath = join(scriptDir, 'fake-codex.sh')
    const argsPath = join(scriptDir, 'args.txt')
    const stdinPath = join(scriptDir, 'stdin.txt')

    try {
      await writeFile(
        scriptPath,
        `#!/bin/sh
args_file="${argsPath}"
stdin_file="${stdinPath}"
output_file=""
prev=""
printf '%s\n' "$@" > "$args_file"
for arg in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then
    output_file="$arg"
    break
  fi
  prev="$arg"
done
cat > "$stdin_file"
if [ -n "$output_file" ]; then
  printf 'codex-final-message' > "$output_file"
fi
printf 'progress\\n' >&2
exit 0
`,
        'utf-8',
      )
      await chmod(scriptPath, 0o755)

      const provider = new CodexCliProvider({ command: scriptPath })
      const result = await provider.run({
        systemPrompt: 'system prompt',
        userPrompt: 'user prompt',
        model: '',
      })

      const args = await readFile(argsPath, 'utf-8')
      const stdin = await readFile(stdinPath, 'utf-8')

      expect(result.rawText).toBe('codex-final-message')
      expect(args).toContain('exec')
      expect(args).toContain('--model')
      expect(args).toContain('gpt-5.4')
      expect(args).toContain('--output-last-message')
      expect(stdin).toContain('system prompt')
      expect(stdin).toContain('user prompt')
    } finally {
      await rm(scriptDir, { recursive: true, force: true })
    }
  })
})
