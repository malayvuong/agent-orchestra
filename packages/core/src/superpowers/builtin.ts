import { getDefaultModelForProvider } from '@malayvuong/agent-orchestra-shared'
import type { Superpower } from './types.js'

const DEFAULT_OPENAI_MODEL = getDefaultModelForProvider('openai')

/**
 * Built-in superpowers shipped with agent-orchestra core.
 * These provide opinionated workflow presets for common tasks.
 */
export const BUILTIN_SUPERPOWERS: Superpower[] = [
  {
    id: 'security-review',
    name: 'Security Review',
    description:
      'Comprehensive security audit using the security-review skill set with a challenger protocol.',
    category: 'review',
    skillSetIds: ['security-review'],
    skillIds: ['security-review'],
    protocol: 'single_challenger',
    runtimeDefaults: {
      skillBudgetPercent: 30,
    },
    agentPreset: {
      architect: {
        enabled: true,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
      reviewer: {
        role: 'reviewer',
        lens: 'security',
        count: 1,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
    },
    maturity: 'safe',
  },
  {
    id: 'dependency-audit',
    name: 'Dependency Audit',
    description:
      'Audits project dependencies for known vulnerabilities, license compliance, and supply chain risks.',
    category: 'analysis',
    skillIds: ['security-review'],
    protocol: 'single_challenger',
    runtimeDefaults: {
      skillBudgetPercent: 25,
    },
    agentPreset: {
      architect: {
        enabled: true,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
      reviewer: {
        role: 'reviewer',
        lens: 'security',
        count: 1,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
    },
    capabilityExpectation: ['fs.read', 'net.http'],
    requiresApproval: true,
    maturity: 'controlled',
  },
  {
    id: 'test-generation',
    name: 'Test Generation',
    description:
      'Generates test cases for the target code following project test conventions and patterns.',
    category: 'testing',
    skillIds: ['test-conventions'],
    protocol: 'single_challenger',
    runtimeDefaults: {
      skillBudgetPercent: 25,
    },
    agentPreset: {
      architect: {
        enabled: true,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
      reviewer: {
        role: 'reviewer',
        lens: 'testing',
        count: 1,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
    },
    maturity: 'safe',
  },
  {
    id: 'auto-fix-lint',
    name: 'Auto-fix Lint',
    description:
      'Automatically fixes linting and code quality issues using the code-quality skill with filesystem and process access.',
    category: 'fix',
    skillIds: ['code-quality'],
    protocol: 'single_challenger',
    runtimeDefaults: {
      skillBudgetPercent: 20,
    },
    agentPreset: {
      architect: {
        enabled: true,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
      reviewer: {
        role: 'reviewer',
        lens: 'logic',
        count: 1,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
    },
    capabilityExpectation: ['fs.read', 'fs.write', 'proc.spawn'],
    requiresApproval: true,
    maturity: 'advanced',
  },
  {
    id: 'plan-review',
    name: 'Plan Review',
    description:
      'Reviews implementation plans, roadmaps, and RFCs for sequencing issues, missing dependencies, scope creep, unrealistic assumptions, and implementation readiness.',
    category: 'review',
    skillSetIds: ['plan-review'],
    skillIds: [
      'sequencing-check',
      'dependency-check',
      'scope-discipline',
      'implementation-readiness',
      'risk-check',
    ],
    protocol: 'single_challenger',
    runtimeDefaults: {
      skillBudgetPercent: 30,
    },
    agentPreset: {
      architect: {
        enabled: true,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
      reviewer: {
        role: 'reviewer',
        lens: 'implementation_readiness',
        count: 1,
        provider: 'openai',
        model: DEFAULT_OPENAI_MODEL,
      },
    },
    maturity: 'safe',
  },
]

/**
 * Retrieve a built-in superpower by its ID.
 * Returns undefined if no built-in superpower matches the given ID.
 */
export function getBuiltinSuperpower(id: string): Superpower | undefined {
  return BUILTIN_SUPERPOWERS.find((sp) => sp.id === id)
}
