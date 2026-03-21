/** Default storage directory for agent-orchestra data */
export const DEFAULT_STORAGE_DIR = '.agent-orchestra'

/** Default job runtime config values (spec v1.3 §4.16) */
export const DEFAULT_RUNTIME_CONFIG = {
  maxConcurrentAgents: 3,
  pausePointsEnabled: false,
  synthesisConfig: {
    provider: 'architect_provider' as const,
    rerunnable: true,
  },
} as const
