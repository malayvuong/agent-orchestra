import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../tool-registry.js'
import type { ToolSpec } from '../tool-registry.js'

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  const makeTool = (overrides: Partial<ToolSpec> = {}): ToolSpec => ({
    name: 'read-file',
    description: 'Read a file from disk',
    category: 'read',
    mutatesState: false,
    externalSideEffect: false,
    requiresApproval: false,
    allowedRoles: ['architect', 'reviewer', 'planner'],
    timeoutMs: 10_000,
    ...overrides,
  })

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  it('should register and get a tool', () => {
    const tool = makeTool()
    registry.register(tool)
    const retrieved = registry.get('read-file')
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe('read-file')
    expect(retrieved!.category).toBe('read')
  })

  it('should list all registered tools', () => {
    registry.register(makeTool({ name: 'tool-a' }))
    registry.register(makeTool({ name: 'tool-b' }))
    expect(registry.list()).toHaveLength(2)
  })

  it('should list tools for a specific role', () => {
    registry.register(makeTool({ name: 'read-file', allowedRoles: ['architect', 'planner'] }))
    registry.register(makeTool({ name: 'write-file', allowedRoles: ['executor', 'builder'] }))

    const architectTools = registry.listForRole('architect')
    expect(architectTools).toHaveLength(1)
    expect(architectTools[0].name).toBe('read-file')

    const executorTools = registry.listForRole('executor')
    expect(executorTools).toHaveLength(1)
    expect(executorTools[0].name).toBe('write-file')
  })

  it('should list tools by category', () => {
    registry.register(makeTool({ name: 'read-file', category: 'read' }))
    registry.register(makeTool({ name: 'write-file', category: 'write' }))
    registry.register(makeTool({ name: 'grep', category: 'read' }))

    const readTools = registry.listByCategory('read')
    expect(readTools).toHaveLength(2)

    const writeTools = registry.listByCategory('write')
    expect(writeTools).toHaveLength(1)
  })

  it('should check if a tool is allowed for a role', () => {
    registry.register(makeTool({ name: 'read-file', allowedRoles: ['architect', 'planner'] }))
    expect(registry.isAllowed('read-file', 'architect')).toBe(true)
    expect(registry.isAllowed('read-file', 'executor')).toBe(false)
  })

  it('should return false for isAllowed on unknown tool', () => {
    expect(registry.isAllowed('nonexistent', 'architect')).toBe(false)
  })

  it('should unregister a tool', () => {
    registry.register(makeTool({ name: 'read-file' }))
    expect(registry.unregister('read-file')).toBe(true)
    expect(registry.get('read-file')).toBeUndefined()
  })

  it('should return false when unregistering unknown tool', () => {
    expect(registry.unregister('nonexistent')).toBe(false)
  })

  it('should return undefined for unknown tool', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })
})
