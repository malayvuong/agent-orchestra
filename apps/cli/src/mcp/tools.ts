/**
 * MCP tool definitions and input schemas for Agent Orchestra.
 *
 * Each tool maps to an existing core service — no new business logic here.
 */

/** Input schema for review_target tool */
export const REVIEW_TARGET_SCHEMA = {
  type: 'object' as const,
  properties: {
    target: {
      type: 'string',
      description: 'File or directory path to review (relative to workspace)',
    },
    superpower: {
      type: 'string',
      description: 'Superpower preset ID (e.g. security-review, plan-review, test-generation)',
    },
    brief: {
      type: 'string',
      description: 'Optional job description or focus area',
    },
    lens: {
      type: 'string',
      description: 'Review lens override (e.g. security, testing, performance, logic)',
    },
  },
  required: ['target'],
}

/** Input schema for review_plan tool */
export const REVIEW_PLAN_SCHEMA = {
  type: 'object' as const,
  properties: {
    target: {
      type: 'string',
      description: 'Path to implementation plan, RFC, or roadmap document',
    },
    brief: {
      type: 'string',
      description: 'Optional focus area for the review',
    },
  },
  required: ['target'],
}

/** Input schema for show_findings tool */
export const SHOW_FINDINGS_SCHEMA = {
  type: 'object' as const,
  properties: {
    jobId: {
      type: 'string',
      description: 'Job ID to retrieve findings for',
    },
  },
  required: ['jobId'],
}

/** Input schema for evaluate_policy tool */
export const EVALUATE_POLICY_SCHEMA = {
  type: 'object' as const,
  properties: {
    capability: {
      type: 'string',
      description: 'Capability to evaluate (fs.read, fs.write, net.http, proc.spawn, secrets.read)',
    },
    scope: {
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
      description: 'Scope to evaluate (file path, URL, or command)',
    },
  },
  required: ['capability'],
}

/** Input schema for get_job tool */
export const GET_JOB_SCHEMA = {
  type: 'object' as const,
  properties: {
    jobId: {
      type: 'string',
      description: 'Job ID to retrieve',
    },
  },
  required: ['jobId'],
}

/** Input schema for compare_runs tool */
export const COMPARE_RUNS_SCHEMA = {
  type: 'object' as const,
  properties: {
    jobId: {
      type: 'string',
      description: 'Anchor job ID to compare against sibling runs',
    },
  },
  required: ['jobId'],
}

/** All MCP tool definitions for registration */
export const TOOL_DEFINITIONS = [
  {
    name: 'list_superpowers',
    description:
      'List all available Agent Orchestra superpowers with their metadata (category, maturity, description).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'review_target',
    description:
      'Run a multi-agent review on a file or directory using the existing orchestration pipeline. ' +
      'Supports superpower presets (security-review, plan-review, test-generation, auto-fix-lint). ' +
      'Returns job ID and findings summary.',
    inputSchema: REVIEW_TARGET_SCHEMA,
  },
  {
    name: 'review_plan',
    description:
      'Review an implementation plan, RFC, or roadmap for sequencing issues, missing dependencies, ' +
      'scope problems, and implementation readiness. Convenience wrapper around review_target with plan-review superpower.',
    inputSchema: REVIEW_PLAN_SCHEMA,
  },
  {
    name: 'show_findings',
    description: 'Retrieve the findings and synthesis summary for a completed review job.',
    inputSchema: SHOW_FINDINGS_SCHEMA,
  },
  {
    name: 'list_skills',
    description:
      'List all installed/available skills with their trigger conditions and descriptions.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'evaluate_policy',
    description:
      'Evaluate whether a capability (fs.read, fs.write, net.http, proc.spawn, secrets.read) ' +
      'is allowed, denied, or requires approval under the current policy configuration.',
    inputSchema: EVALUATE_POLICY_SCHEMA,
  },
  {
    name: 'get_job',
    description:
      'Retrieve full details of a review job including status, agents, scope, and configuration.',
    inputSchema: GET_JOB_SCHEMA,
  },
  {
    name: 'compare_runs',
    description: 'Compare runs that share the same original baseline snapshot or entry target.',
    inputSchema: COMPARE_RUNS_SCHEMA,
  },
]
