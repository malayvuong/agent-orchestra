import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProgram } from '../program.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Setup — use the real loadSuperpowerCatalog from @agent-orchestra/core.
// The catalog is self-contained (no I/O) so no mocking is needed.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// superpowers list
// ---------------------------------------------------------------------------

describe('superpowers list command', () => {
  it('displays all 5 superpowers', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'list'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('security-review')
    expect(combined).toContain('dependency-audit')
    expect(combined).toContain('test-generation')
    expect(combined).toContain('auto-fix-lint')
    expect(combined).toContain('plan-review')
  })

  it('displays superpower IDs with their categories in padded columns', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'list'])

    restore()

    const combined = output.join('\n')
    // Each line should contain the superpower ID and its category
    expect(combined).toContain('security-review')
    expect(combined).toContain('review')
    expect(combined).toContain('testing')
    expect(combined).toContain('fix')
    expect(combined).toContain('analysis')
  })

  it('shows maturity level for each superpower', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'list'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('safe')
    expect(combined).toContain('controlled')
    expect(combined).toContain('advanced')
  })

  it('shows header text indicating available superpowers', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'list'])

    restore()

    const combined = output.join('\n')
    // The list command prints "Available Superpowers (N):" as header
    expect(combined).toContain('Available Superpowers (5)')
  })
})

// ---------------------------------------------------------------------------
// superpowers show
// ---------------------------------------------------------------------------

describe('superpowers show command', () => {
  it('displays details for security-review', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'security-review'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('security-review')
    expect(combined).toContain('Category: review')
    expect(combined).toContain('Maturity: safe')
  })

  it('displays description for security-review', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'security-review'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Description:')
    expect(combined).toContain('security')
  })

  it('displays reviewer info with lens', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'security-review'])

    restore()

    const combined = output.join('\n')
    // Format: "Reviewer: role=reviewer, lens=security, count=1"
    expect(combined).toContain('Reviewer:')
    expect(combined).toContain('lens=security')
  })

  it('displays architect info when enabled', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'security-review'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Architect: enabled')
  })

  it('displays protocol info', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'security-review'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Protocol: single_challenger')
  })

  it('displays skills list', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'security-review'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Skills:')
  })

  it('shows "Approval required: yes" for dependency-audit', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'dependency-audit'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('dependency-audit')
    expect(combined).toContain('Approval required: yes')
  })

  it('shows capabilities for dependency-audit', async () => {
    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'dependency-audit'])

    restore()

    const combined = output.join('\n')
    expect(combined).toContain('Capabilities:')
    expect(combined).toContain('fs.read')
    expect(combined).toContain('net.http')
  })

  it('shows error for nonexistent superpower', async () => {
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await expect(
      program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'nonexistent']),
    ).rejects.toThrow()

    restore()
    processExitSpy.mockRestore()

    const combined = output.join('\n')
    expect(combined).toContain('nonexistent')
    expect(combined).toContain('not found')
  })

  it('shows error with available superpowers when ID is not found', async () => {
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { output, restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    await expect(
      program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show', 'nonexistent']),
    ).rejects.toThrow()

    restore()
    processExitSpy.mockRestore()

    const combined = output.join('\n')
    // The error message includes available superpower IDs
    expect(combined).toContain('security-review')
  })

  it('commander errors when <id> argument is missing', async () => {
    const { restore } = captureConsole()
    const program = createProgram()
    program.exitOverride()

    // Commander treats `show` with no argument as a missing required arg
    await expect(
      program.parseAsync(['node', 'agent-orchestra', 'superpowers', 'show']),
    ).rejects.toThrow()

    restore()
  })
})

// ---------------------------------------------------------------------------
// superpowers command registration
// ---------------------------------------------------------------------------

describe('superpowers command — registration', () => {
  it('program has superpowers command registered', () => {
    const program = createProgram()
    const superpowers = program.commands.find((c) => c.name() === 'superpowers')
    expect(superpowers).toBeDefined()
  })

  it('superpowers command has list and show subcommands', () => {
    const program = createProgram()
    const superpowers = program.commands.find((c) => c.name() === 'superpowers')
    const subcommands = superpowers?.commands.map((c) => c.name())
    expect(subcommands).toContain('list')
    expect(subcommands).toContain('show')
  })
})
