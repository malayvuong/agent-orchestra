/**
 * Types for the sandbox execution environment (Phase F — Task 4.1).
 *
 * Defines the configuration, mount, result, and artifact types used
 * by the SandboxRunner to execute plugin-type skills in isolated
 * Docker containers with restricted capabilities.
 *
 * @module
 */

import type { SkillArtifact } from '../executor/types.js'

// ---------------------------------------------------------------------------
// Container ID alias
// ---------------------------------------------------------------------------

/** Opaque string alias representing a Docker container ID. */
export type ContainerId = string

// ---------------------------------------------------------------------------
// Sandbox Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a sandboxed skill execution environment.
 *
 * Controls resource limits, network isolation, filesystem mounts,
 * and environment variable injection for the container.
 */
export type SandboxConfig = {
  /** Container image to use (default: node:20-slim). */
  image: string
  /** Memory limit in MB (default: 256). */
  memoryLimitMb: number
  /** CPU quota (0-1, default: 0.5 = half a core). */
  cpuQuota: number
  /** Filesystem mounts (read-only by default). */
  mounts: SandboxMount[]
  /** Network mode: none (no network) or restricted (domain allowlist). */
  networkMode: 'none' | 'restricted'
  /** Allowed outbound domains (only when networkMode = 'restricted'). */
  allowedDomains: string[]
  /** Wall-clock timeout in milliseconds. */
  timeoutMs: number
  /** Environment variables to inject (sanitized before use). */
  env: Record<string, string>
}

// ---------------------------------------------------------------------------
// Sandbox Mount
// ---------------------------------------------------------------------------

/**
 * A filesystem mount binding a host path into the container.
 *
 * Mounts default to read-only to prevent untrusted code from
 * modifying the host filesystem.
 */
export type SandboxMount = {
  /** Absolute path on the host. */
  hostPath: string
  /** Absolute path inside the container. */
  containerPath: string
  /** Whether the mount is read-only (true) or read-write (false). */
  readOnly: boolean
}

// ---------------------------------------------------------------------------
// Sandbox Result
// ---------------------------------------------------------------------------

/**
 * Result of a sandboxed skill execution.
 *
 * Captures exit code, stdout/stderr, collected artifacts, timing,
 * and whether the container was killed (by timeout, OOM, or signal).
 */
export type SandboxResult = {
  /** Process exit code (-1 if killed before exit). */
  exitCode: number
  /** Standard output captured from the container. */
  stdout: string
  /** Standard error captured from the container. */
  stderr: string
  /** Artifacts collected from the /output directory. */
  artifacts: SandboxArtifact[]
  /** Wall-clock execution duration in milliseconds. */
  durationMs: number
  /** True if the container was killed by timeout, OOM, or signal. */
  killed: boolean
  /** Reason the container was killed, if applicable. */
  killReason?: 'timeout' | 'oom' | 'signal'
}

// ---------------------------------------------------------------------------
// Sandbox Artifact
// ---------------------------------------------------------------------------

/**
 * An artifact produced by a sandboxed skill execution.
 *
 * Extends the base SkillArtifact with sandbox-specific metadata
 * about the file path within the container output directory.
 */
export type SandboxArtifact = SkillArtifact & {
  /** Relative path of the artifact file within the /output directory. */
  file?: string
}

// ---------------------------------------------------------------------------
// Docker exec result (internal)
// ---------------------------------------------------------------------------

/**
 * Raw result from a Docker CLI command execution.
 */
export type DockerExecResult = {
  stdout: string
  stderr: string
  exitCode: number
}

// ---------------------------------------------------------------------------
// Artifact manifest (written by plugin scripts)
// ---------------------------------------------------------------------------

/**
 * Manifest format written by plugin scripts to /output/artifacts.json.
 *
 * Plugin scripts produce this file to declare what artifacts they
 * generated during execution.
 */
export type ArtifactManifest = {
  artifacts: ArtifactManifestEntry[]
}

/**
 * A single entry in the artifact manifest.
 */
export type ArtifactManifestEntry = {
  /** Type of the artifact (finding, report, metric, file, test_result). */
  type: 'finding' | 'report' | 'metric' | 'file' | 'test_result'
  /** Relative file path within /output (for file-based artifacts). */
  file?: string
  /** Artifact name (for metric-type artifacts). */
  name?: string
  /** Artifact value (for metric-type artifacts). */
  value?: string
  /** Whether to include in subsequent round contexts. */
  includeInContext?: boolean
}
