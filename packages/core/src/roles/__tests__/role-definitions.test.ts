import { describe, it, expect } from 'vitest'
import { ROLE_DEFINITIONS, getRoleDefinition } from '../role-definitions.js'
import type { AgentRole } from '../../types/agent.js'

describe('ROLE_DEFINITIONS', () => {
  const expectedRoles: AgentRole[] = [
    'architect',
    'reviewer',
    'builder',
    'planner',
    'executor',
    'verifier',
    'researcher',
    'operator',
  ]

  it('should contain all 8 roles', () => {
    for (const role of expectedRoles) {
      expect(ROLE_DEFINITIONS[role]).toBeDefined()
    }
    expect(Object.keys(ROLE_DEFINITIONS)).toHaveLength(8)
  })

  it('should return correct role from getRoleDefinition', () => {
    const def = getRoleDefinition('planner')
    expect(def).toBeDefined()
    expect(def!.role).toBe('planner')
    expect(def!.description).toContain('Decomposes')
  })

  it('should return undefined for unknown role', () => {
    const def = getRoleDefinition('unknown' as AgentRole)
    expect(def).toBeUndefined()
  })

  it('planner cannot mutate state', () => {
    expect(ROLE_DEFINITIONS.planner.canMutateState).toBe(false)
  })

  it('executor can mutate state', () => {
    expect(ROLE_DEFINITIONS.executor.canMutateState).toBe(true)
  })

  it('researcher can access external', () => {
    expect(ROLE_DEFINITIONS.researcher.canAccessExternal).toBe(true)
  })

  it('each role has a valid outputContract', () => {
    const validFormats = ['findings', 'plan', 'evidence', 'summary', 'freeform']
    for (const role of expectedRoles) {
      const def = ROLE_DEFINITIONS[role]
      expect(def.outputContract).toBeDefined()
      expect(def.outputContract.requiredFields.length).toBeGreaterThan(0)
      expect(validFormats).toContain(def.outputContract.format)
    }
  })
})
