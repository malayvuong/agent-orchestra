/**
 * Default sandbox configuration and trust-tier-based config factory.
 *
 * Provides sensible defaults for sandboxed skill execution and
 * maps trust tiers to appropriate resource limits and network
 * isolation levels.
 *
 * @module
 */

import type { TrustTier } from '../policy/trust-tier.js'
import type { SandboxConfig } from './types.js'

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/**
 * Default sandbox configuration for plugin skill execution.
 *
 * - Image: node:20-slim (minimal Node.js runtime)
 * - Memory: 256 MB
 * - CPU: 0.5 cores (half a core)
 * - Network: none (fully isolated)
 * - Timeout: 30 seconds
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  image: 'node:20-slim',
  memoryLimitMb: 256,
  cpuQuota: 0.5,
  mounts: [],
  networkMode: 'none',
  allowedDomains: [],
  timeoutMs: 30_000,
  env: {},
}

// ---------------------------------------------------------------------------
// Trust-tier-based configuration
// ---------------------------------------------------------------------------

/**
 * Return the appropriate sandbox configuration for a given trust tier.
 *
 * Only `official` and `verified` tiers are allowed to run plugin-type
 * skills in a sandbox. Community and experimental tiers are rejected
 * with an error — they should never reach sandbox execution.
 *
 * | Tier         | Memory | CPU | Network    | Timeout |
 * |-------------|--------|-----|------------|---------|
 * | official    | 512 MB | 1.0 | restricted | 60s     |
 * | verified    | 256 MB | 0.5 | none       | 30s     |
 * | community   | N/A    | N/A | N/A        | N/A     |
 * | experimental| N/A    | N/A | N/A        | N/A     |
 *
 * @param tier - The trust tier of the skill.
 * @returns A SandboxConfig appropriate for the tier.
 * @throws Error if the tier does not permit sandbox execution.
 */
export function sandboxConfigByTrustTier(tier: TrustTier): SandboxConfig {
  switch (tier) {
    case 'official':
      return {
        ...DEFAULT_SANDBOX_CONFIG,
        memoryLimitMb: 512,
        cpuQuota: 1.0,
        networkMode: 'restricted',
        timeoutMs: 60_000,
      }

    case 'verified':
      return {
        ...DEFAULT_SANDBOX_CONFIG,
        memoryLimitMb: 256,
        cpuQuota: 0.5,
        networkMode: 'none',
        timeoutMs: 30_000,
      }

    case 'community':
      throw new Error(
        `Trust tier 'community' does not permit plugin execution. ` +
          `Only 'official' and 'verified' tiers can run sandboxed plugins.`,
      )

    case 'experimental':
      throw new Error(
        `Trust tier 'experimental' does not permit plugin execution. ` +
          `Only 'official' and 'verified' tiers can run sandboxed plugins.`,
      )

    default: {
      const _exhaustive: never = tier
      throw new Error(`Unknown trust tier: ${_exhaustive}`)
    }
  }
}
