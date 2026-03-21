/**
 * Sandbox module — isolated container execution for plugin-type skills.
 *
 * @module
 */

// Types
export type {
  SandboxConfig,
  SandboxMount,
  SandboxResult,
  SandboxArtifact,
  ContainerId,
  DockerExecResult,
  ArtifactManifest,
  ArtifactManifestEntry,
} from './types.js'

// Docker CLI wrapper
export { DockerCli } from './docker.js'

// Configuration
export { DEFAULT_SANDBOX_CONFIG, sandboxConfigByTrustTier } from './config.js'

// Runner
export { SandboxRunner } from './runner.js'
export type { SandboxLogger } from './runner.js'

// Network
export { createRestrictedNetwork, removeNetwork } from './network.js'
