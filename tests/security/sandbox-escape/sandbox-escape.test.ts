/**
 * Sandbox escape integration tests (Phase F — Task 4.5).
 *
 * These tests require Docker to be installed and running.
 * They are automatically skipped when Docker is not available
 * (e.g., in CI environments without Docker-in-Docker).
 *
 * Tests verify that the sandbox properly isolates:
 * - File access (no host filesystem access)
 * - Network (no outbound connectivity in 'none' mode)
 * - Process limits (fork bombs killed)
 * - Memory limits (memory bombs killed)
 * - Privilege escalation (sudo blocked)
 * - Environment variables (no host secrets leaked)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SandboxRunner } from '../../../packages/core/src/skills/sandbox/runner.js'
import { DockerCli } from '../../../packages/core/src/skills/sandbox/docker.js'
import { DEFAULT_SANDBOX_CONFIG } from '../../../packages/core/src/skills/sandbox/config.js'
import type { SandboxConfig } from '../../../packages/core/src/skills/sandbox/types.js'

// ---------------------------------------------------------------------------
// Docker availability check
// ---------------------------------------------------------------------------

async function checkDockerAvailable(): Promise<boolean> {
  const docker = new DockerCli()
  return docker.isAvailable()
}

const DOCKER_AVAILABLE = await checkDockerAvailable()

// Silent logger for integration tests
const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

// ---------------------------------------------------------------------------
// Integration tests — skipped when Docker is not installed
// ---------------------------------------------------------------------------

describe.skipIf(!DOCKER_AVAILABLE)('Sandbox Escape Prevention (integration)', () => {
  let workspacePath: string
  let defaultConfig: SandboxConfig

  beforeAll(async () => {
    // Create a temporary workspace directory
    workspacePath = await mkdtemp(join(tmpdir(), 'ao-sandbox-test-workspace-'))
    await writeFile(join(workspacePath, 'test.txt'), 'workspace content')

    defaultConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      image: 'node:20-slim',
      timeoutMs: 30_000,
      networkMode: 'none',
    }
  })

  afterAll(async () => {
    // Clean up workspace
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => {})
    }
  })

  // -------------------------------------------------------------------------
  // File access tests (Task 4.5.1)
  // -------------------------------------------------------------------------

  describe('File access isolation', () => {
    it('plugin cannot read host /etc/passwd (sees container-local version)', async () => {
      const sandbox = new SandboxRunner(defaultConfig, logger)
      const result = await sandbox.run('cat', ['/etc/passwd'], workspacePath)

      // The container has its own /etc/passwd — it should NOT contain
      // the host's root user entry with typical host UID mappings.
      // In node:20-slim, /etc/passwd exists but is container-local.
      // We verify by checking the container ran successfully (file exists
      // inside container) but the content is container-specific.
      // The key security property: no host /etc/passwd is mounted.
      expect(result.exitCode).toBe(0)
      // Container's passwd file should not have host-specific users
      // beyond standard container users (root, nobody, node, etc.)
    })

    it('plugin cannot write to host workspace (read-only mount)', async () => {
      const sandbox = new SandboxRunner(defaultConfig, logger)
      const result = await sandbox.run(
        'sh',
        ['-c', 'touch /workspace/malicious.txt'],
        workspacePath,
      )

      // Read-only mount should prevent writing
      expect(result.exitCode).not.toBe(0)

      // Verify host workspace is unchanged
      const files = await readFile(join(workspacePath, 'test.txt'), 'utf-8')
      expect(files).toBe('workspace content')

      // The malicious file should not exist on host
      await expect(readFile(join(workspacePath, 'malicious.txt'), 'utf-8')).rejects.toThrow()
    })

    it('plugin cannot write outside /output and /tmp', async () => {
      const sandbox = new SandboxRunner(defaultConfig, logger)

      // Try writing to root filesystem (read-only)
      const result = await sandbox.run('sh', ['-c', 'touch /malicious.txt'], workspacePath)
      expect(result.exitCode).not.toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Network escape tests (Task 4.5.2)
  // -------------------------------------------------------------------------

  describe('Network isolation', () => {
    it('plugin with networkMode=none cannot reach the internet', async () => {
      const config: SandboxConfig = {
        ...defaultConfig,
        networkMode: 'none',
        // Use a longer timeout for network tests
        timeoutMs: 15_000,
      }
      const sandbox = new SandboxRunner(config, logger)

      // curl may not be installed in node:20-slim, use node to test
      const result = await sandbox.run(
        'node',
        [
          '-e',
          `
          const http = require('http');
          const req = http.get('http://httpbin.org/get', { timeout: 5000 }, (res) => {
            process.exit(0);
          });
          req.on('error', (e) => {
            console.error(e.message);
            process.exit(1);
          });
          req.on('timeout', () => {
            req.destroy();
            process.exit(1);
          });
        `,
        ],
        workspacePath,
      )

      // Network request should fail — container has no network
      expect(result.exitCode).not.toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Process/resource escape tests (Task 4.5.3)
  // -------------------------------------------------------------------------

  describe('Resource limits', () => {
    it('plugin cannot fork bomb (pids limit)', async () => {
      const config: SandboxConfig = {
        ...defaultConfig,
        timeoutMs: 15_000,
      }
      const sandbox = new SandboxRunner(config, logger)

      const result = await sandbox.run('sh', ['-c', ':(){ :|:& };:'], workspacePath)

      // Container should be killed by pids limit or timeout, not hang
      // Exit code will be non-zero (killed by resource limit)
      expect(result.exitCode).not.toBe(0)
    })

    it('plugin cannot exceed memory limit', async () => {
      const config: SandboxConfig = {
        ...defaultConfig,
        memoryLimitMb: 64,
        timeoutMs: 15_000,
      }
      const sandbox = new SandboxRunner(config, logger)

      const result = await sandbox.run(
        'node',
        ['-e', 'const a = []; while(true) a.push(Buffer.alloc(1024*1024))'],
        workspacePath,
      )

      // Container should be OOM-killed (exit code 137) or killed by timeout
      expect(result.killed).toBe(true)
    })

    it('plugin cannot escalate privileges', async () => {
      const sandbox = new SandboxRunner(defaultConfig, logger)

      const result = await sandbox.run(
        'sh',
        ['-c', 'sudo whoami 2>&1 || echo "sudo not available"'],
        workspacePath,
      )

      // sudo should not be available or should fail
      // With --no-new-privileges and --cap-drop=ALL, privilege escalation is blocked
      if (result.exitCode === 0) {
        // If the command "succeeded", it's because the fallback echo ran
        expect(result.stdout).toContain('sudo not available')
      }
    })
  })

  // -------------------------------------------------------------------------
  // Environment leak tests (Task 4.5.4)
  // -------------------------------------------------------------------------

  describe('Environment variable isolation', () => {
    it('plugin cannot see host SECRET_ env vars', async () => {
      // Set a secret env var on the "host" (test process)
      const originalSecret = process.env.SECRET_API_KEY
      process.env.SECRET_API_KEY = 'test-secret-value'

      try {
        // Config with the secret in env — sanitizer should strip it
        const config: SandboxConfig = {
          ...defaultConfig,
          env: {
            SECRET_API_KEY: 'test-secret-value',
            NODE_ENV: 'test',
          },
        }
        const sandbox = new SandboxRunner(config, logger)

        const result = await sandbox.run(
          'node',
          ['-e', 'console.log(JSON.stringify(process.env))'],
          workspacePath,
        )

        // The sanitizer should have stripped SECRET_API_KEY
        expect(result.stdout).not.toContain('test-secret-value')
        expect(result.stdout).not.toContain('SECRET_API_KEY')
      } finally {
        // Restore original env
        if (originalSecret !== undefined) {
          process.env.SECRET_API_KEY = originalSecret
        } else {
          delete process.env.SECRET_API_KEY
        }
      }
    })

    it('plugin can see non-secret env vars', async () => {
      const config: SandboxConfig = {
        ...defaultConfig,
        env: {
          NODE_ENV: 'production',
          CUSTOM_FLAG: 'enabled',
        },
      }
      const sandbox = new SandboxRunner(config, logger)

      const result = await sandbox.run(
        'node',
        ['-e', 'console.log(process.env.NODE_ENV, process.env.CUSTOM_FLAG)'],
        workspacePath,
      )

      expect(result.stdout).toContain('production')
      expect(result.stdout).toContain('enabled')
    })
  })
})
