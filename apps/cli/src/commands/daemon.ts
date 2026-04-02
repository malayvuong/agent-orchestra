import type { Command } from 'commander'
import { resolve, join, dirname } from 'node:path'
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { existsSync, openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const STORAGE_DIR_NAME = '.agent-orchestra'
const DAEMON_DIR_NAME = 'daemon'

function handleErrors<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
  return async (...args: T): Promise<void> => {
    try {
      await fn(...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      process.exit(1)
    }
  }
}

function getDaemonDir(workspacePath: string): string {
  return join(workspacePath, STORAGE_DIR_NAME, DAEMON_DIR_NAME)
}

function getPidFile(workspacePath: string): string {
  return join(getDaemonDir(workspacePath), 'daemon.pid')
}

function getLogFile(workspacePath: string): string {
  return join(getDaemonDir(workspacePath), 'daemon.log')
}

async function readPid(workspacePath: string): Promise<number | null> {
  try {
    const raw = await readFile(getPidFile(workspacePath), 'utf-8')
    const pid = parseInt(raw.trim())
    return Number.isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function isServerResponding(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

// ---------------------------------------------------------------------------
// daemon start
// ---------------------------------------------------------------------------

async function daemonStart(opts: { path: string; port: string }): Promise<void> {
  const workspacePath = resolve(opts.path)
  const daemonDir = getDaemonDir(workspacePath)
  const port = parseInt(opts.port)

  // Check if already running
  const existingPid = await readPid(workspacePath)
  if (existingPid && isProcessAlive(existingPid)) {
    const responding = await isServerResponding(port)
    if (responding) {
      console.log(`Daemon already running (PID ${existingPid})`)
      console.log(`Dashboard: http://localhost:${port}/`)
      return
    }
    // Process alive but not responding — stale, clean up
    console.log(`Cleaning up stale PID ${existingPid}...`)
  }

  await mkdir(daemonDir, { recursive: true })

  const logFile = getLogFile(workspacePath)
  const logFd = openSync(logFile, 'a')

  // Find the server entry point
  const target = resolveServerScript()

  const child = spawn(process.execPath, [...target.execArgs, target.script], {
    cwd: workspacePath,
    env: {
      ...process.env,
      PORT: String(port),
      STORAGE_DIR: join(workspacePath, STORAGE_DIR_NAME),
      NODE_ENV: 'production',
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })

  child.unref()

  if (!child.pid) {
    console.error('Failed to start daemon')
    process.exit(1)
  }

  await writeFile(getPidFile(workspacePath), String(child.pid))

  // Wait briefly for server to come up
  let ready = false
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (await isServerResponding(port)) {
      ready = true
      break
    }
  }

  if (ready) {
    console.log(`Daemon started (PID ${child.pid})`)
    console.log(`Dashboard: http://localhost:${port}/`)
    console.log(`Logs: ${logFile}`)
  } else {
    console.log(`Daemon started (PID ${child.pid}) but not yet responding on port ${port}`)
    console.log(`Check logs: ${logFile}`)
  }
}

type ServerTarget = { script: string; execArgs: string[] }

function resolveServerScript(): ServerTarget {
  // Try multiple resolution strategies:
  // 1. Relative from this file (works in dev with tsx and in dist with node)
  // 2. Relative from CLI package root (works when tsup bundles to dist/)
  const candidates = [
    // From source: apps/cli/src/commands/ → apps/server/
    join(__dirname, '../../../server/dist/index.js'),
    join(__dirname, '../../../server/src/index.ts'),
    // From dist: apps/cli/dist/ → apps/server/
    join(__dirname, '../../server/dist/index.js'),
    join(__dirname, '../../server/src/index.ts'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const isTsFile = candidate.endsWith('.ts')
      return {
        script: candidate,
        execArgs: isTsFile ? ['--import', 'tsx'] : [],
      }
    }
  }

  throw new Error(
    'Could not find server entry point. Run `pnpm build` first or use `ao serve` for foreground mode.',
  )
}

// ---------------------------------------------------------------------------
// daemon stop
// ---------------------------------------------------------------------------

async function daemonStop(opts: { path: string }): Promise<void> {
  const workspacePath = resolve(opts.path)
  const pid = await readPid(workspacePath)

  if (!pid) {
    console.log('No daemon PID file found. Daemon is not running.')
    return
  }

  if (!isProcessAlive(pid)) {
    console.log(`Daemon PID ${pid} is not running. Cleaning up PID file.`)
    await cleanupPidFile(workspacePath)
    return
  }

  console.log(`Stopping daemon (PID ${pid})...`)
  process.kill(pid, 'SIGTERM')

  // Wait for graceful shutdown
  let stopped = false
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (!isProcessAlive(pid)) {
      stopped = true
      break
    }
  }

  if (stopped) {
    console.log('Daemon stopped.')
    await cleanupPidFile(workspacePath)
  } else {
    console.log(`Daemon did not stop gracefully. Sending SIGKILL...`)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already dead */
    }
    await cleanupPidFile(workspacePath)
    console.log('Daemon killed.')
  }
}

async function cleanupPidFile(workspacePath: string): Promise<void> {
  try {
    await unlink(getPidFile(workspacePath))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// daemon status
// ---------------------------------------------------------------------------

async function daemonStatus(opts: { path: string; port: string }): Promise<void> {
  const workspacePath = resolve(opts.path)
  const port = parseInt(opts.port)
  const pid = await readPid(workspacePath)

  if (!pid) {
    console.log('Status: stopped (no PID file)')
    return
  }

  const alive = isProcessAlive(pid)
  const responding = alive ? await isServerResponding(port) : false

  if (!alive) {
    console.log(`Status: dead (PID ${pid} not running, stale PID file)`)
    return
  }

  if (responding) {
    // Get server info
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`)
      const data = await resp.json()
      console.log(`Status: running`)
      console.log(`PID: ${pid}`)
      console.log(`Port: ${port}`)
      console.log(`Version: ${data.version}`)
      console.log(`Uptime: ${Math.floor(data.uptime)}s`)
      console.log(`Dashboard: http://localhost:${port}/`)
    } catch {
      console.log(`Status: running (PID ${pid}, port ${port})`)
    }
  } else {
    console.log(`Status: starting (PID ${pid} alive, not responding on port ${port} yet)`)
  }
}

// ---------------------------------------------------------------------------
// daemon logs
// ---------------------------------------------------------------------------

async function daemonLogs(opts: { path: string; lines: string; follow: boolean }): Promise<void> {
  const workspacePath = resolve(opts.path)
  const logFile = getLogFile(workspacePath)

  try {
    const content = await readFile(logFile, 'utf-8')
    const lines = content.split('\n')
    const n = parseInt(opts.lines) || 50
    const tail = lines.slice(-n).join('\n')
    console.log(tail)

    if (opts.follow) {
      const { watch } = await import('node:fs')
      console.log('\n--- watching for new logs (Ctrl+C to stop) ---\n')
      let lastSize = content.length
      watch(logFile, async () => {
        try {
          const updated = await readFile(logFile, 'utf-8')
          if (updated.length > lastSize) {
            process.stdout.write(updated.slice(lastSize))
            lastSize = updated.length
          }
        } catch {
          /* ignore */
        }
      })
      // Keep process alive
      await new Promise(() => {})
    }
  } catch {
    console.log('No daemon log file found.')
    console.log(`Expected at: ${logFile}`)
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDaemonCommand(program: Command): void {
  const daemon = program
    .command('daemon')
    .description('Manage the Agent Orchestra background daemon')

  daemon
    .command('start')
    .description('Start the daemon (server + scheduler) in background')
    .option('--path <path>', 'Workspace path', process.cwd())
    .option('--port <port>', 'Server port', '3100')
    .action(handleErrors(daemonStart))

  daemon
    .command('stop')
    .description('Stop the running daemon')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(handleErrors(daemonStop))

  daemon
    .command('status')
    .description('Check daemon status')
    .option('--path <path>', 'Workspace path', process.cwd())
    .option('--port <port>', 'Server port', '3100')
    .action(handleErrors(daemonStatus))

  daemon
    .command('logs')
    .description('Show daemon logs')
    .option('--path <path>', 'Workspace path', process.cwd())
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output', false)
    .action(handleErrors(daemonLogs))
}
