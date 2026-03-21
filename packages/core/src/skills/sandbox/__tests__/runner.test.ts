/**
 * Unit tests for SandboxRunner and related sandbox modules.
 *
 * All tests mock DockerCli — no Docker installation required.
 * Tests verify that the runner builds correct docker args,
 * handles timeouts, collects artifacts, and sanitizes env vars.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SandboxRunner } from '../runner.js'
import type { DockerCli } from '../docker.js'
import { DEFAULT_SANDBOX_CONFIG, sandboxConfigByTrustTier } from '../config.js'
import type { SandboxConfig, DockerExecResult } from '../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock DockerCli with sensible defaults. */
function createMockDocker(overrides?: Partial<DockerCli>): DockerCli {
  const mock = {
    exec: vi
      .fn<(args: string[], timeout?: number) => Promise<DockerExecResult>>()
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    create: vi.fn<(args: string[]) => Promise<string>>().mockResolvedValue('abc123container'),
    start: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    kill: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    rm: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    logs: vi
      .fn<(id: string, stream: 'stdout' | 'stderr') => Promise<string>>()
      .mockResolvedValue(''),
    wait: vi.fn<(id: string) => Promise<number>>().mockResolvedValue(0),
    cleanup: vi.fn<(prefix: string) => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DockerCli

  return mock
}

/** Silent logger that captures nothing (prevents console noise in tests). */
const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

/** A minimal valid config for tests. */
const testConfig: SandboxConfig = {
  ...DEFAULT_SANDBOX_CONFIG,
  env: { NODE_ENV: 'test', SAFE_VAR: 'ok' },
}

// ---------------------------------------------------------------------------
// SandboxRunner.run — docker arg construction
// ---------------------------------------------------------------------------

describe('SandboxRunner.run', () => {
  let mockDocker: DockerCli

  beforeEach(() => {
    mockDocker = createMockDocker()
    vi.restoreAllMocks()
  })

  it('builds correct docker args with --cap-drop=ALL, --read-only, etc.', async () => {
    const runner = new SandboxRunner(testConfig, silentLogger, mockDocker)

    await runner.run('node', ['index.js'], '/workspace/project')

    const createCall = vi.mocked(mockDocker.create).mock.calls[0]
    expect(createCall).toBeDefined()
    const args = createCall[0]

    expect(args).toContain('--cap-drop=ALL')
    expect(args).toContain('--read-only')
    expect(args).toContain('--no-new-privileges')
    expect(args).toContain('--security-opt=no-new-privileges:true')
    expect(args).toContain('--pids-limit=100')
    expect(args).toContain('--tmpfs=/tmp:rw,size=64m')
    expect(args).toContain(`--memory=${testConfig.memoryLimitMb}m`)
    expect(args).toContain(`--cpus=${testConfig.cpuQuota}`)
  })

  it('mounts workspace read-only and output directory writable', async () => {
    const runner = new SandboxRunner(testConfig, silentLogger, mockDocker)

    await runner.run('node', ['index.js'], '/workspace/project')

    const args = vi.mocked(mockDocker.create).mock.calls[0][0]

    // Workspace mount (read-only)
    const wsVolIdx = args.findIndex(
      (a: string) => a.includes('/workspace/project') && a.includes(':ro'),
    )
    expect(wsVolIdx).toBeGreaterThan(-1)

    // Output mount (writable)
    const outputVolIdx = args.findIndex((a: string) => a.includes('/output:rw'))
    expect(outputVolIdx).toBeGreaterThan(-1)
  })

  it('adds --network=none when networkMode is none', async () => {
    const config: SandboxConfig = { ...testConfig, networkMode: 'none' }
    const runner = new SandboxRunner(config, silentLogger, mockDocker)

    await runner.run('node', ['index.js'], '/workspace/project')

    const args = vi.mocked(mockDocker.create).mock.calls[0][0]
    expect(args).toContain('--network=none')
  })

  it('timeout kills container and returns killed=true with killReason=timeout', async () => {
    // Make docker.wait never resolve (simulating a long-running container)
    const neverResolve = new Promise<number>(() => {})
    const mockDockerTimeout = createMockDocker({
      wait: vi.fn<(id: string) => Promise<number>>().mockReturnValue(neverResolve),
    })

    const config: SandboxConfig = { ...testConfig, timeoutMs: 50 }
    const runner = new SandboxRunner(config, silentLogger, mockDockerTimeout)

    const result = await runner.run('sleep', ['60'], '/workspace/project')

    expect(result.killed).toBe(true)
    expect(result.killReason).toBe('timeout')
    expect(result.exitCode).toBe(-1)
    expect(vi.mocked(mockDockerTimeout.kill)).toHaveBeenCalled()
  })

  it('collects stdout and stderr from docker logs', async () => {
    const mockDockerLogs = createMockDocker({
      logs: vi
        .fn<(id: string, stream: 'stdout' | 'stderr') => Promise<string>>()
        .mockImplementation(async (_id: string, stream: 'stdout' | 'stderr') => {
          if (stream === 'stdout') return 'hello stdout'
          return 'hello stderr'
        }),
    })

    const runner = new SandboxRunner(testConfig, silentLogger, mockDockerLogs)
    const result = await runner.run('echo', ['hi'], '/workspace/project')

    expect(result.stdout).toBe('hello stdout')
    expect(result.stderr).toBe('hello stderr')
    expect(result.exitCode).toBe(0)
    expect(result.killed).toBe(false)
  })

  it('sanitizes environment variables (strips secrets)', async () => {
    const config: SandboxConfig = {
      ...testConfig,
      env: {
        NODE_ENV: 'production',
        SECRET_KEY: 'super-secret',
        API_KEY: 'my-api-key',
        SAFE_VAR: 'safe',
        AWS_ACCESS_KEY_ID: 'AKIA...',
        GH_TOKEN: 'ghp_abc',
        GITHUB_TOKEN: 'ghp_123',
      },
    }
    const runner = new SandboxRunner(config, silentLogger, mockDocker)

    await runner.run('node', ['index.js'], '/workspace/project')

    const args = vi.mocked(mockDocker.create).mock.calls[0][0]

    // Safe vars should be present
    expect(args).toContain('-e')
    const envArgs = args.filter((_: string, i: number) => i > 0 && args[i - 1] === '-e')
    const envKeys = envArgs.map((a: string) => a.split('=')[0])

    expect(envKeys).toContain('NODE_ENV')
    expect(envKeys).toContain('SAFE_VAR')

    // Secret vars should NOT be present
    expect(envKeys).not.toContain('SECRET_KEY')
    expect(envKeys).not.toContain('API_KEY')
    expect(envKeys).not.toContain('AWS_ACCESS_KEY_ID')
    expect(envKeys).not.toContain('GH_TOKEN')
    expect(envKeys).not.toContain('GITHUB_TOKEN')
  })

  it('passes script and args to the container', async () => {
    const runner = new SandboxRunner(testConfig, silentLogger, mockDocker)

    await runner.run('node', ['--max-old-space-size=128', 'index.js'], '/workspace/project')

    const args = vi.mocked(mockDocker.create).mock.calls[0][0]

    // Image should be in the args, followed by the script and args
    const imageIdx = args.indexOf(testConfig.image)
    expect(imageIdx).toBeGreaterThan(-1)
    expect(args[imageIdx + 1]).toBe('node')
    expect(args[imageIdx + 2]).toBe('--max-old-space-size=128')
    expect(args[imageIdx + 3]).toBe('index.js')
  })

  it('throws SandboxUnavailableError when Docker is not available', async () => {
    const mockDockerUnavailable = createMockDocker({
      isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    })

    const runner = new SandboxRunner(testConfig, silentLogger, mockDockerUnavailable)

    await expect(runner.run('node', ['index.js'], '/workspace/project')).rejects.toThrow(
      'Docker is required for plugin skill execution',
    )
  })

  it('cleans up container on successful run', async () => {
    const runner = new SandboxRunner(testConfig, silentLogger, mockDocker)

    await runner.run('node', ['index.js'], '/workspace/project')

    expect(vi.mocked(mockDocker.rm)).toHaveBeenCalledWith('abc123container')
  })

  it('cleans up container even on error', async () => {
    const mockDockerError = createMockDocker({
      start: vi.fn<(id: string) => Promise<void>>().mockRejectedValue(new Error('start failed')),
    })

    const runner = new SandboxRunner(testConfig, silentLogger, mockDockerError)

    await expect(runner.run('node', ['index.js'], '/workspace/project')).rejects.toThrow(
      'start failed',
    )

    expect(vi.mocked(mockDockerError.rm)).toHaveBeenCalledWith('abc123container')
  })

  it('detects OOM kill (exit code 137)', async () => {
    const mockDockerOom = createMockDocker({
      wait: vi.fn<(id: string) => Promise<number>>().mockResolvedValue(137),
    })

    const runner = new SandboxRunner(testConfig, silentLogger, mockDockerOom)
    const result = await runner.run('node', ['-e', 'Buffer.alloc(1e9)'], '/workspace/project')

    expect(result.exitCode).toBe(137)
    expect(result.killed).toBe(true)
    expect(result.killReason).toBe('oom')
  })

  it('includes additional mounts from config', async () => {
    const config: SandboxConfig = {
      ...testConfig,
      mounts: [
        { hostPath: '/data/models', containerPath: '/models', readOnly: true },
        { hostPath: '/tmp/cache', containerPath: '/cache', readOnly: false },
      ],
    }
    const runner = new SandboxRunner(config, silentLogger, mockDocker)

    await runner.run('node', ['index.js'], '/workspace/project')

    const args = vi.mocked(mockDocker.create).mock.calls[0][0]

    expect(args).toContain('/data/models:/models:ro')
    expect(args).toContain('/tmp/cache:/cache')
  })
})

// ---------------------------------------------------------------------------
// SandboxRunner.checkRuntime
// ---------------------------------------------------------------------------

describe('SandboxRunner.checkRuntime', () => {
  it('returns true when Docker is available', async () => {
    const mockDocker = createMockDocker({
      isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    })

    const runner = new SandboxRunner(testConfig, silentLogger, mockDocker)
    expect(await runner.checkRuntime()).toBe(true)
  })

  it('returns false when Docker is unavailable', async () => {
    const mockDocker = createMockDocker({
      isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    })

    const runner = new SandboxRunner(testConfig, silentLogger, mockDocker)
    expect(await runner.checkRuntime()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SandboxRunner.cleanup
// ---------------------------------------------------------------------------

describe('SandboxRunner.cleanup', () => {
  it('removes orphaned containers with ao-skill- prefix', async () => {
    const mockDocker = createMockDocker()
    const runner = new SandboxRunner(testConfig, silentLogger, mockDocker)

    await runner.cleanup()

    expect(vi.mocked(mockDocker.cleanup)).toHaveBeenCalledWith('ao-skill-')
  })
})

// ---------------------------------------------------------------------------
// sandboxConfigByTrustTier
// ---------------------------------------------------------------------------

describe('sandboxConfigByTrustTier', () => {
  it('returns 512MB/1.0CPU/restricted for official tier', () => {
    const config = sandboxConfigByTrustTier('official')
    expect(config.memoryLimitMb).toBe(512)
    expect(config.cpuQuota).toBe(1.0)
    expect(config.networkMode).toBe('restricted')
    expect(config.timeoutMs).toBe(60_000)
  })

  it('returns 256MB/0.5CPU/none for verified tier', () => {
    const config = sandboxConfigByTrustTier('verified')
    expect(config.memoryLimitMb).toBe(256)
    expect(config.cpuQuota).toBe(0.5)
    expect(config.networkMode).toBe('none')
    expect(config.timeoutMs).toBe(30_000)
  })

  it('throws for community tier', () => {
    expect(() => sandboxConfigByTrustTier('community')).toThrow(
      /community.*does not permit plugin execution/,
    )
  })

  it('throws for experimental tier', () => {
    expect(() => sandboxConfigByTrustTier('experimental')).toThrow(
      /experimental.*does not permit plugin execution/,
    )
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_SANDBOX_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_SANDBOX_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_SANDBOX_CONFIG.image).toBe('node:20-slim')
    expect(DEFAULT_SANDBOX_CONFIG.memoryLimitMb).toBe(256)
    expect(DEFAULT_SANDBOX_CONFIG.cpuQuota).toBe(0.5)
    expect(DEFAULT_SANDBOX_CONFIG.networkMode).toBe('none')
    expect(DEFAULT_SANDBOX_CONFIG.timeoutMs).toBe(30_000)
    expect(DEFAULT_SANDBOX_CONFIG.mounts).toEqual([])
    expect(DEFAULT_SANDBOX_CONFIG.env).toEqual({})
    expect(DEFAULT_SANDBOX_CONFIG.allowedDomains).toEqual([])
  })
})
