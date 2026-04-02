/** Spec v1.3 §4.3 */
export type DebateRole = 'architect' | 'reviewer' | 'builder'
export type GeneralRole = 'planner' | 'executor' | 'verifier' | 'researcher' | 'operator'
export type AgentRole = DebateRole | GeneralRole

/** Spec v1.3 §4.4 */
export type AgentLens =
  | 'logic'
  | 'consistency'
  | 'regression'
  | 'testing'
  | 'performance'
  | 'security'
  | 'cross_system_contract'
  | 'scope'
  | 'dependency'
  | 'sequencing'
  | 'simplification'
  | 'risk'
  | 'implementation_readiness'

/** Spec v1.3 §4.8 */
export type AgentConnectionType = 'api' | 'cli' | 'bridge'
export type AgentConfig = {
  id: string
  name: string
  role: AgentRole
  lens?: AgentLens
  connectionType: AgentConnectionType
  providerKey: string
  modelOrCommand: string
  protocolPreset: string
  enabled: boolean
  maxFindings?: number
  allowReferenceScan: boolean
  canWriteCode: boolean
  timeoutMs?: number
  retryCount?: number
  tokenBudget?: number
  envRefs?: string[]
  workingDirectory?: string
  commandTemplate?: string
  notes?: string
}

/** Spec v1.3 §4.9 */
export type AgentAssignment = {
  id: string
  agentConfigId: string
  role: AgentRole
  lens?: AgentLens
  connectionType: AgentConnectionType
  providerKey: string
  modelOrCommand: string
  protocol: string
  enabled: boolean
  maxFindings?: number
  allowReferenceScan: boolean
  canWriteCode: boolean

  /** Optional skill set assigned to this agent (Task 1.1) */
  skillSetId?: string
}
