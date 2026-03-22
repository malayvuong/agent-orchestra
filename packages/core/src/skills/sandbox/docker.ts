/**
 * Thin wrapper around Docker CLI for sandbox container management.
 *
 * All container operations are performed via `docker` sub-commands
 * executed through `child_process.execFile`. This avoids a dependency
 * on the Docker SDK while providing the minimal surface area needed
 * by the SandboxRunner.
 *
 * @module
 */

import { execFile } from 'node:child_process'
import type { ContainerId, DockerExecResult } from './types.js'

/** Default timeout for Docker CLI commands (60 seconds). */
const DEFAULT_DOCKER_TIMEOUT_MS = 60_000

/**
 * Thin wrapper around the Docker CLI.
 *
 * Provides typed methods for container lifecycle operations:
 * create, start, stop, kill, rm, logs, wait, and cleanup.
 */
export class DockerCli {
  /**
   * Execute an arbitrary `docker <args>` command.
   *
   * @param args    - Arguments to pass after `docker`.
   * @param timeout - Wall-clock timeout in milliseconds (default: 60s).
   * @returns The stdout, stderr, and exit code of the command.
   */
  async exec(args: string[], timeout?: number): Promise<DockerExecResult> {
    const timeoutMs = timeout ?? DEFAULT_DOCKER_TIMEOUT_MS

    return new Promise<DockerExecResult>((resolve, reject) => {
      const child = execFile(
        'docker',
        args,
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && 'killed' in error && error.killed) {
            // Process was killed by timeout
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode: -1,
            })
            return
          }

          // execFile sets error for non-zero exit codes
          const exitCode =
            error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0

          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode,
          })
        },
      )

      // Safety: if the child process itself can't be spawned
      child.on('error', (err) => {
        reject(err)
      })
    })
  }

  /**
   * Check whether Docker is available on the host.
   *
   * Runs `docker info` and returns true if the command succeeds.
   *
   * @returns True if Docker daemon is reachable, false otherwise.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.exec(['info'], 10_000)
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  /**
   * Create a new container without starting it.
   *
   * @param args - Arguments to pass to `docker create`.
   * @returns The container ID (trimmed from stdout).
   */
  async create(args: string[]): Promise<ContainerId> {
    const result = await this.exec(['create', ...args])
    if (result.exitCode !== 0) {
      throw new Error(`docker create failed (exit ${result.exitCode}): ${result.stderr}`)
    }
    return result.stdout.trim()
  }

  /**
   * Start an existing container.
   *
   * @param containerId - The container to start.
   */
  async start(containerId: ContainerId): Promise<void> {
    const result = await this.exec(['start', containerId])
    if (result.exitCode !== 0) {
      throw new Error(`docker start failed (exit ${result.exitCode}): ${result.stderr}`)
    }
  }

  /**
   * Stop a running container gracefully.
   *
   * @param containerId - The container to stop.
   */
  async stop(containerId: ContainerId): Promise<void> {
    const result = await this.exec(['stop', containerId])
    if (result.exitCode !== 0) {
      throw new Error(`docker stop failed (exit ${result.exitCode}): ${result.stderr}`)
    }
  }

  /**
   * Force-kill a running container.
   *
   * @param containerId - The container to kill.
   */
  async kill(containerId: ContainerId): Promise<void> {
    // docker kill may fail if container already stopped — that's OK
    await this.exec(['kill', containerId])
  }

  /**
   * Remove a container (force).
   *
   * @param containerId - The container to remove.
   */
  async rm(containerId: ContainerId): Promise<void> {
    await this.exec(['rm', '-f', containerId])
  }

  /**
   * Retrieve logs from a container.
   *
   * @param containerId - The container to read logs from.
   * @param stream      - Which stream to capture: 'stdout' or 'stderr'.
   * @returns The log output as a string.
   */
  async logs(containerId: ContainerId, stream: 'stdout' | 'stderr'): Promise<string> {
    const result = await this.exec(['logs', containerId])
    if (stream === 'stdout') {
      return result.stdout || result.stderr
    }

    return result.stderr || result.stdout
  }

  /**
   * Wait for a container to exit and return its exit code.
   *
   * @param containerId - The container to wait on.
   * @returns The container's exit code.
   */
  async wait(containerId: ContainerId): Promise<number> {
    const result = await this.exec(['wait', containerId], 0)
    if (result.exitCode !== 0 && result.stdout.trim() === '') {
      throw new Error(`docker wait failed (exit ${result.exitCode}): ${result.stderr}`)
    }
    return parseInt(result.stdout.trim(), 10)
  }

  /**
   * Clean up all containers whose name starts with the given prefix.
   *
   * Lists running/stopped containers matching the prefix, kills them,
   * and removes them.
   *
   * @param prefix - Container name prefix to match (e.g. "ao-skill-").
   */
  async cleanup(prefix: string): Promise<void> {
    // List all containers (running + stopped) with the prefix
    const listResult = await this.exec([
      'ps',
      '-a',
      '--filter',
      `name=${prefix}`,
      '--format',
      '{{.ID}}',
    ])

    if (listResult.exitCode !== 0 || listResult.stdout.trim() === '') {
      return
    }

    const containerIds = listResult.stdout.trim().split('\n').filter(Boolean)

    // Kill and remove each container
    for (const id of containerIds) {
      await this.kill(id)
      await this.rm(id)
    }
  }
}
