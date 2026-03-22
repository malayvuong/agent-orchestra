import { describe, it, expect } from 'vitest'
import { createProgram } from '../program.js'

describe('CLI program', () => {
  it('should create program with name agent-orchestra', () => {
    const program = createProgram()
    expect(program.name()).toBe('agent-orchestra')
  })

  it('should have skills command registered', () => {
    const program = createProgram()
    const skills = program.commands.find((c) => c.name() === 'skills')
    expect(skills).toBeDefined()
  })

  it('should have skills subcommands', () => {
    const program = createProgram()
    const skills = program.commands.find((c) => c.name() === 'skills')
    const subcommands = skills?.commands.map((c) => c.name())
    expect(subcommands).toContain('list')
    expect(subcommands).toContain('show')
    expect(subcommands).toContain('match')
    expect(subcommands).toContain('validate')
  })
})

// ---------------------------------------------------------------------------
// Backward compatibility — run command without --superpower
// ---------------------------------------------------------------------------

describe('CLI program — backward compatibility (superpowers)', () => {
  it('run command does not require --superpower option', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')
    expect(run).toBeDefined()

    // --superpower should be an optional option (not a requiredOption),
    // meaning the command works fine without providing it.
    // In Commander, .option() registers an optional flag while .requiredOption()
    // registers a mandatory one. We verify --superpower is NOT in the list
    // of required options by checking that the run command does not throw
    // when --superpower is absent (i.e., --target is the only requiredOption).
    const requiredOptions = run!.options.filter((o) => o.mandatory)
    const superpowerRequired = requiredOptions.find((o) => o.long === '--superpower')
    expect(superpowerRequired).toBeUndefined()
  })

  it('run command still has --target as a required option', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')
    expect(run).toBeDefined()

    const targetOption = run!.options.find((o) => o.long === '--target')
    expect(targetOption).toBeDefined()
    expect(targetOption!.required).toBe(true)
  })

  it('run command still has --provider, --model, --lens, --protocol options', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')
    expect(run).toBeDefined()

    const optionLongs = run!.options.map((o) => o.long)
    expect(optionLongs).toContain('--provider')
    expect(optionLongs).toContain('--model')
    expect(optionLongs).toContain('--lens')
    expect(optionLongs).toContain('--protocol')
  })

  it('run command defaults for --provider, --model, --lens, --protocol are preserved', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')
    expect(run).toBeDefined()

    const providerOpt = run!.options.find((o) => o.long === '--provider')
    const modelOpt = run!.options.find((o) => o.long === '--model')
    const lensOpt = run!.options.find((o) => o.long === '--lens')
    const protocolOpt = run!.options.find((o) => o.long === '--protocol')

    // Verify defaults haven't been removed (they may differ from exact strings
    // if superpowers modify them, but they should still exist)
    expect(providerOpt?.defaultValue).toBeTruthy()
    // Model default is provider-dependent (no static default)
    expect(modelOpt).toBeDefined()
    expect(lensOpt?.defaultValue).toBeTruthy()
    expect(protocolOpt?.defaultValue).toBeTruthy()
  })
})
