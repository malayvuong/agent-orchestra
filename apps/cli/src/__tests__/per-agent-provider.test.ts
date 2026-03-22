import { describe, it, expect } from 'vitest'
import { createProgram } from '../program.js'

// ---------------------------------------------------------------------------
// CLI flag registration
// ---------------------------------------------------------------------------

describe('run command — per-agent provider flags', () => {
  it('has --architect-provider option', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')!
    const optionLongs = run.options.map((o) => o.long)
    expect(optionLongs).toContain('--architect-provider')
  })

  it('has --architect-model option', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')!
    const optionLongs = run.options.map((o) => o.long)
    expect(optionLongs).toContain('--architect-model')
  })

  it('has --reviewer-provider option', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')!
    const optionLongs = run.options.map((o) => o.long)
    expect(optionLongs).toContain('--reviewer-provider')
  })

  it('has --reviewer-model option', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')!
    const optionLongs = run.options.map((o) => o.long)
    expect(optionLongs).toContain('--reviewer-model')
  })

  it('per-agent flags are optional (no default)', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')!

    const archProvider = run.options.find((o) => o.long === '--architect-provider')
    const archModel = run.options.find((o) => o.long === '--architect-model')
    const revProvider = run.options.find((o) => o.long === '--reviewer-provider')
    const revModel = run.options.find((o) => o.long === '--reviewer-model')

    // These should NOT have defaults — they override only when explicitly set
    expect(archProvider?.defaultValue).toBeUndefined()
    expect(archModel?.defaultValue).toBeUndefined()
    expect(revProvider?.defaultValue).toBeUndefined()
    expect(revModel?.defaultValue).toBeUndefined()
  })

  it('--provider default is auto', () => {
    const program = createProgram()
    const run = program.commands.find((c) => c.name() === 'run')!
    const provider = run.options.find((o) => o.long === '--provider')
    expect(provider?.defaultValue).toBe('auto')
  })
})
