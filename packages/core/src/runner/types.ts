import type { RunRecord, RunMode, RunRequest, SessionState } from '../types/runtime.js'

export type RunnerResult = {
  runRecord: RunRecord
  output?: string
  artifacts?: Array<{ name: string; content: string }>
  error?: string
}

export interface Runner {
  readonly mode: RunMode
  execute(request: RunRequest, session: SessionState): Promise<RunnerResult>
  cancel(runId: string): Promise<void>
}

export type AutomationJobDefinition = {
  id: string
  name: string
  description?: string
  schedule?: string // "every 5m", "every 1h", "every 1d"
  trigger?: 'cron' | 'webhook' | 'watch'
  workflow: WorkflowStep[]
  notify?: NotifyConfig
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastRunStatus?: 'ok' | 'failed'
}

export type WorkflowStep = {
  id: string
  type: 'tool_call' | 'model_prompt' | 'script' | 'conditional'
  name: string
  config: Record<string, unknown>
  dependsOn?: string[]
  timeoutMs?: number
  retryCount?: number
}

export type NotifyConfig = {
  onSuccess?: NotifyTarget[]
  onFailure?: NotifyTarget[]
  onTimeout?: NotifyTarget[]
}

export type NotifyTarget = {
  type: 'console' | 'file' | 'webhook' | 'telegram'
  destination: string
}

// Step executor interface — each step type implements this
export interface StepExecutor {
  execute(
    step: WorkflowStep,
    options: { timeout?: number },
  ): Promise<{
    summary: string
    artifact?: { name: string; content: string }
  }>
}
