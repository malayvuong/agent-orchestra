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
