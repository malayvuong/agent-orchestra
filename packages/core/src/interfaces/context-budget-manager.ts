import type { AgentContext } from '../types/index.js'

/** Spec v1.3 §20.2 */
export interface ContextBudgetManager {
  fitToLimit(context: AgentContext, tokenLimit: number): AgentContext
}
