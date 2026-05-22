import type { AgentRole } from '../types/agent.js'

export type ToolCategory = 'read' | 'write' | 'exec' | 'external' | 'message'

export type OutputContract = {
  requiredFields: string[]
  format: 'findings' | 'plan' | 'evidence' | 'summary' | 'freeform'
  maxLength?: number
}

export type RoleDefinition = {
  role: AgentRole
  description: string
  allowedToolCategories: ToolCategory[]
  canMutateState: boolean
  canAccessExternal: boolean
  outputContract: OutputContract
  defaultTimeoutMs: number
}

export const ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  // Existing debate roles
  architect: {
    role: 'architect',
    description:
      'Analyzes targets, surfaces trade-offs, and checks implementation readiness before design decisions become work.',
    allowedToolCategories: ['read'],
    canMutateState: false,
    canAccessExternal: false,
    outputContract: { requiredFields: ['findings'], format: 'findings' },
    defaultTimeoutMs: 60_000,
  },
  reviewer: {
    role: 'reviewer',
    description:
      'Challenges findings through a focused lens with scoped, actionable evidence and checklist-style review discipline.',
    allowedToolCategories: ['read'],
    canMutateState: false,
    canAccessExternal: false,
    outputContract: { requiredFields: ['findings'], format: 'findings' },
    defaultTimeoutMs: 60_000,
  },
  builder: {
    role: 'builder',
    description:
      'Executes code changes from accepted findings, acceptance criteria, and verification evidence without widening scope.',
    allowedToolCategories: ['read', 'write', 'exec'],
    canMutateState: true,
    canAccessExternal: false,
    outputContract: { requiredFields: ['actions', 'evidence'], format: 'evidence' },
    defaultTimeoutMs: 120_000,
  },
  // New general roles
  planner: {
    role: 'planner',
    description:
      'Decomposes tasks with scale-adaptive depth, choosing quick spec, story plan, or full architecture gates. No risky actions.',
    allowedToolCategories: ['read'],
    canMutateState: false,
    canAccessExternal: false,
    outputContract: { requiredFields: ['steps', 'delegations'], format: 'plan' },
    defaultTimeoutMs: 30_000,
  },
  executor: {
    role: 'executor',
    description:
      'Runs tools, edits files, and executes commands against acceptance criteria with story-sized scope control.',
    allowedToolCategories: ['read', 'write', 'exec'],
    canMutateState: true,
    canAccessExternal: false,
    outputContract: { requiredFields: ['actions', 'evidence'], format: 'evidence' },
    defaultTimeoutMs: 120_000,
  },
  verifier: {
    role: 'verifier',
    description:
      'Checks whether work actually happened, re-reads current source snapshots, and confirms outputs with evidence.',
    allowedToolCategories: ['read'],
    canMutateState: false,
    canAccessExternal: false,
    outputContract: { requiredFields: ['verified', 'evidence', 'issues'], format: 'evidence' },
    defaultTimeoutMs: 30_000,
  },
  researcher: {
    role: 'researcher',
    description:
      'Fetches docs and web info from primary sources, summarizes with citations, and avoids copying source prose.',
    allowedToolCategories: ['read', 'external'],
    canMutateState: false,
    canAccessExternal: true,
    outputContract: { requiredFields: ['findings', 'sources'], format: 'summary' },
    defaultTimeoutMs: 60_000,
  },
  operator: {
    role: 'operator',
    description: 'Handles cron/background jobs. Deterministic, low-chatter.',
    allowedToolCategories: ['read', 'write', 'exec', 'external'],
    canMutateState: true,
    canAccessExternal: true,
    outputContract: { requiredFields: ['status', 'result'], format: 'evidence' },
    defaultTimeoutMs: 300_000,
  },
}

export function getRoleDefinition(role: AgentRole): RoleDefinition | undefined {
  return ROLE_DEFINITIONS[role]
}
