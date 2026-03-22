/**
 * Sandbox runner for plugin-type skill execution (Phase F — Task 4.1).
 *
 * Executes plugin scripts inside isolated Docker containers with:
 * - Dropped capabilities (--cap-drop=ALL)
 * - Read-only root filesystem (--read-only)
 * - Memory and CPU limits
 * - PID limit (--pids-limit=100)
 * - No privilege escalation (--security-opt=no-new-privileges:true)
 * - Network isolation (none or restricted)
 * - Writable /tmp (tmpfs, 64 MB max)
 * - Writable /output for artifact collection
 *
 * @module
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { SandboxUnavailableError } from '@malayvuong/agent-orchestra-shared'
import { sanitizeEnvironment } from '../executor/transports/env-sanitizer.js'
import { DockerCli } from './docker.js'
import { createRestrictedNetwork, removeNetwork } from './network.js'
import type {
  ContainerId,
  SandboxConfig,
  SandboxResult,
  SandboxArtifact,
  ArtifactManifest,
} from './types.js'

/** Prefix for all sandbox container names. */
const CONTAINER_NAME_PREFIX = 'ao-skill-'

/**
 * Logger interface used by SandboxRunner.
 */
export interface SandboxLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

/**
 * Execute plugin-type skills inside isolated Docker containers.
 *
 * The runner manages the full container lifecycle:
 * 1. Validate Docker availability
 * 2. Create a temp artifact output directory
 * 3. Build and create a container with security restrictions
 * 4. Mount workspace (read-only) and artifact dir (writable)
 * 5. Start the container and wait with timeout
 * 6. Collect stdout, stderr, and artifacts
 * 7. Remove the container
 */
export class SandboxRunner {
  private readonly docker: DockerCli
  private readonly config: SandboxConfig
  private readonly logger: SandboxLogger

  /**
   * @param config - Sandbox configuration (resource limits, network, etc.).
   * @param logger - Optional logger for diagnostics.
   * @param docker - Optional DockerCli instance (for testing/injection).
   */
  constructor(config: SandboxConfig, logger?: SandboxLogger, docker?: DockerCli) {
    this.config = config
    this.logger = logger ?? {
      info: (msg: string) => console.log(`[sandbox] ${msg}`),
      warn: (msg: string) => console.warn(`[sandbox] ${msg}`),
      error: (msg: string) => console.error(`[sandbox] ${msg}`),
    }
    this.docker = docker ?? new DockerCli()
  }

  /**
   * Execute a plugin skill's script inside a container.
   *
   * Flow:
   * 1. Validate config against policy
   * 2. Create container with restricted capabilities
   * 3. Mount workspace (read-only) and artifact output dir (write)
   * 4. Run script with timeout
   * 5. Collect artifacts from output dir
   * 6. Destroy container
   *
   * @param script        - The command/script to run inside the container.
   * @param args          - Arguments to pass to the script.
   * @param workspacePath - Host path to the workspace (mounted read-only).
   * @returns Execution result with stdout, stderr, artifacts, and timing.
   * @throws SandboxUnavailableError if Docker is not available.
   */
  async run(script: string, args: string[], workspacePath: string): Promise<SandboxResult> {
    // 1. Check Docker availability
    if (!(await this.docker.isAvailable())) {
      throw new SandboxUnavailableError()
    }

    // 2. Create temp artifact output directory
    const artifactDir = await mkdtemp(join(tmpdir(), 'ao-sandbox-output-'))
    const containerName = this.generateContainerName()
    let containerId: ContainerId | undefined
    let networkName: string | undefined

    try {
      // 3. Create restricted network if needed
      if (this.config.networkMode === 'restricted') {
        networkName = `ao-net-${containerName}`
        await createRestrictedNetwork(networkName, this.config.allowedDomains, this.logger)
      }

      // 4. Build docker create args
      const createArgs = this.buildCreateArgs(
        containerName,
        workspacePath,
        artifactDir,
        networkName,
        script,
        args,
      )

      // 5. Create container
      containerId = await this.docker.create(createArgs)
      this.logger.info(`Container created: ${containerId} (${containerName})`)

      // 6. Start container and wait with timeout
      const startTime = Date.now()
      await this.docker.start(containerId)

      const result = await this.waitWithTimeout(containerId, this.config.timeoutMs)
      const durationMs = Date.now() - startTime

      if (result === 'timeout') {
        this.logger.warn(`Container ${containerName} timed out after ${this.config.timeoutMs}ms`)
        await this.docker.kill(containerId)

        const stdout = await this.safeGetLogs(containerId, 'stdout')
        const stderr = await this.safeGetLogs(containerId, 'stderr')

        return {
          exitCode: -1,
          stdout,
          stderr,
          artifacts: [],
          durationMs: this.config.timeoutMs,
          killed: true,
          killReason: 'timeout',
        }
      }

      // 7. Collect results
      const exitCode = result
      const stdout = await this.safeGetLogs(containerId, 'stdout')
      const stderr = await this.safeGetLogs(containerId, 'stderr')

      // Check for OOM kill
      const killed = exitCode === 137
      const killReason = killed ? ('oom' as const) : undefined

      // 8. Collect artifacts from output dir
      const artifacts = await this.collectArtifacts(artifactDir)

      return {
        exitCode,
        stdout,
        stderr,
        artifacts,
        durationMs,
        killed,
        killReason,
      }
    } finally {
      // 9. Cleanup: remove container and temp dirs
      if (containerId) {
        await this.docker.rm(containerId).catch(() => {})
      }
      if (networkName) {
        await removeNetwork(networkName).catch(() => {})
      }
      await rm(artifactDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Check if Docker/container runtime is available.
   *
   * @returns True if Docker is reachable.
   */
  async checkRuntime(): Promise<boolean> {
    return this.docker.isAvailable()
  }

  /**
   * Clean up orphaned containers from previous runs.
   *
   * Removes all containers whose name starts with "ao-skill-".
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up orphaned sandbox containers...')
    await this.docker.cleanup(CONTAINER_NAME_PREFIX)
    this.logger.info('Cleanup complete.')
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the full argument list for `docker create` with all
   * security restrictions from the spec.
   */
  private buildCreateArgs(
    containerName: string,
    workspacePath: string,
    artifactDir: string,
    networkName: string | undefined,
    script: string,
    args: string[],
  ): string[] {
    const dockerArgs: string[] = [
      '--name',
      containerName,
      `--memory=${this.config.memoryLimitMb}m`,
      `--cpus=${this.config.cpuQuota}`,
      '--pids-limit=100',
      '--read-only',
      '--tmpfs=/tmp:rw,size=64m',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
    ]

    // Network restrictions
    if (this.config.networkMode === 'none') {
      dockerArgs.push('--network=none')
    } else if (this.config.networkMode === 'restricted' && networkName) {
      dockerArgs.push(`--network=${networkName}`)
    }

    // Mount workspace as read-only
    dockerArgs.push('-v', `${workspacePath}:/workspace:ro`)

    // Mount artifact output directory as writable
    dockerArgs.push('-v', `${artifactDir}:/output:rw`)

    // Additional mounts from config
    for (const mount of this.config.mounts) {
      const ro = mount.readOnly ? ':ro' : ''
      dockerArgs.push('-v', `${mount.hostPath}:${mount.containerPath}${ro}`)
    }

    // Sanitized environment variables
    const sanitizedEnv = sanitizeEnvironment(this.config.env)
    for (const [key, value] of Object.entries(sanitizedEnv)) {
      dockerArgs.push('-e', `${key}=${value}`)
    }

    // Image
    dockerArgs.push(this.config.image)

    // Command: script + args
    dockerArgs.push(script, ...args)

    return dockerArgs
  }

  /**
   * Wait for a container to exit, with a wall-clock timeout.
   *
   * Uses Promise.race between `docker wait` and a timer.
   *
   * @param containerId - The container to wait on.
   * @param timeoutMs   - Maximum wait time in milliseconds.
   * @returns The container exit code, or 'timeout' if the timer fires first.
   */
  private async waitWithTimeout(
    containerId: ContainerId,
    timeoutMs: number,
  ): Promise<number | 'timeout'> {
    return Promise.race([
      this.docker.wait(containerId),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), timeoutMs)
      }),
    ])
  }

  /**
   * Safely retrieve logs from a container, returning empty string on error.
   */
  private async safeGetLogs(
    containerId: ContainerId,
    stream: 'stdout' | 'stderr',
  ): Promise<string> {
    try {
      return await this.docker.logs(containerId, stream)
    } catch {
      return ''
    }
  }

  /**
   * Collect artifacts from the output directory by reading artifacts.json.
   *
   * If artifacts.json does not exist, returns an empty array.
   *
   * @param artifactDir - Host path to the artifact output directory.
   * @returns Array of sandbox artifacts.
   */
  private async collectArtifacts(artifactDir: string): Promise<SandboxArtifact[]> {
    const manifestPath = join(artifactDir, 'artifacts.json')
    let manifest: ArtifactManifest

    try {
      const raw = await readFile(manifestPath, 'utf-8')
      manifest = JSON.parse(raw) as ArtifactManifest
    } catch {
      // No manifest — return empty artifacts
      return []
    }

    if (!manifest.artifacts || !Array.isArray(manifest.artifacts)) {
      return []
    }

    const artifacts: SandboxArtifact[] = []

    for (const entry of manifest.artifacts) {
      if (entry.file) {
        // File-based artifact — read its contents
        try {
          const filePath = join(artifactDir, entry.file)
          const content = await readFile(filePath, 'utf-8')

          // Try to parse as JSON, fall back to string
          let parsedContent: string | Record<string, unknown>
          try {
            parsedContent = JSON.parse(content) as Record<string, unknown>
          } catch {
            parsedContent = content
          }

          artifacts.push({
            type: entry.type,
            name: entry.name ?? entry.file,
            content: parsedContent,
            includeInContext: entry.includeInContext ?? false,
            file: entry.file,
          })
        } catch {
          // File not readable — skip
          this.logger.warn(`Artifact file not readable: ${entry.file}`)
        }
      } else if (entry.type === 'metric' && entry.name && entry.value !== undefined) {
        // Metric artifact (name + value, no file)
        artifacts.push({
          type: 'metric',
          name: entry.name,
          content: entry.value,
          includeInContext: entry.includeInContext ?? false,
        })
      }
    }

    return artifacts
  }

  /**
   * Generate a unique container name with the ao-skill- prefix.
   *
   * Format: ao-skill-{timestamp}-{random}
   */
  private generateContainerName(): string {
    const random = randomBytes(4).toString('hex')
    return `${CONTAINER_NAME_PREFIX}${Date.now()}-${random}`
  }
}
