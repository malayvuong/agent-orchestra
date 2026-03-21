/**
 * Non-overridable system rules and default policy configuration.
 *
 * System rules enforce security invariants that no user-defined policy
 * can override: SSRF protection, dangerous command blocking, and
 * direct secret file access prevention.
 */

import { BLOCKED_NET_TARGETS, BLOCKED_PROC_COMMANDS, BLOCKED_SECRET_PATHS } from '../types.js'
import type { NonOverridableRule, SkillPolicy } from './types.js'

/**
 * System rules that cannot be overridden by any policy level.
 *
 * These enforce:
 * - SSRF protection: block all RFC1918, loopback, link-local, and metadata IPs
 * - Dangerous commands: block destructive/escalation process commands
 * - Secret access: block direct reads of credential and key files
 */
export const SYSTEM_RULES: NonOverridableRule[] = [
  {
    capability: 'net.http',
    blockedScopes: [...BLOCKED_NET_TARGETS],
    reason: 'SSRF protection: internal/metadata IPs blocked',
  },
  {
    capability: 'proc.spawn',
    blockedScopes: [...BLOCKED_PROC_COMMANDS],
    reason: 'Dangerous command blocked',
  },
  {
    capability: 'secrets.read',
    blockedScopes: [...BLOCKED_SECRET_PATHS],
    reason: 'Direct secret file access blocked',
  },
]

/**
 * Default deny-by-default policy applied when no custom policy is configured.
 *
 * - All capabilities denied unless explicitly allowed by a rule
 * - 30-second maximum execution timeout
 * - Network access disabled
 */
export const DEFAULT_POLICY: SkillPolicy = {
  defaultAction: 'deny',
  rules: [],
  maxExecutionMs: 30_000,
  networkAllowed: false,
}
