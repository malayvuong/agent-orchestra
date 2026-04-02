import type { AgentRole } from '../types/agent.js'
import type { ToolCategory } from '../roles/role-definitions.js'

export type ToolSpec = {
  name: string
  description: string
  category: ToolCategory
  mutatesState: boolean
  externalSideEffect: boolean
  requiresApproval: boolean
  allowedRoles: AgentRole[]
  timeoutMs: number
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export class ToolRegistry {
  private tools: Map<string, ToolSpec> = new Map()

  register(tool: ToolSpec): void {
    this.tools.set(tool.name, tool)
  }
  get(name: string): ToolSpec | undefined {
    return this.tools.get(name)
  }
  list(): ToolSpec[] {
    return [...this.tools.values()]
  }
  listForRole(role: AgentRole): ToolSpec[] {
    return [...this.tools.values()].filter((t) => t.allowedRoles.includes(role))
  }
  listByCategory(category: ToolCategory): ToolSpec[] {
    return [...this.tools.values()].filter((t) => t.category === category)
  }
  isAllowed(toolName: string, role: AgentRole): boolean {
    const t = this.tools.get(toolName)
    return t ? t.allowedRoles.includes(role) : false
  }
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }
}
