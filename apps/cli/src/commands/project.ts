import type { Command } from 'commander'
import { resolve, join } from 'node:path'
import { stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import {
  listProjects,
  registerProject,
  unregisterProject,
  touchProject,
  getProject,
} from '@malayvuong/agent-orchestra-core'

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

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString()
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

async function isOrchestraProject(path: string): Promise<boolean> {
  try {
    const s = await stat(join(path, '.agent-orchestra'))
    return s.isDirectory()
  } catch {
    return false
  }
}

async function checkDaemonAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

// ---------------------------------------------------------------------------
// project list
// ---------------------------------------------------------------------------

async function projectList(): Promise<void> {
  const projects = await listProjects()

  if (projects.length === 0) {
    console.log('No projects registered.')
    console.log('')
    console.log('Register the current project:')
    console.log('  ao project add')
    console.log('')
    console.log('Or run setup in any project:')
    console.log('  ao setup')
    return
  }

  console.log(`\nProjects (${projects.length}):\n`)

  for (const p of projects) {
    const isInitialized = await isOrchestraProject(p.path)
    const daemonAlive = p.daemonPort ? await checkDaemonAlive(p.daemonPort) : false

    const statusIcon = daemonAlive
      ? '\x1b[32m●\x1b[0m'
      : isInitialized
        ? '\x1b[33m○\x1b[0m'
        : '\x1b[31m✗\x1b[0m'
    const daemonInfo = daemonAlive ? `  daemon: http://localhost:${p.daemonPort}/` : ''

    console.log(`  ${statusIcon} ${p.name}`)
    console.log(`    Path: ${p.path}`)
    console.log(
      `    Kind: ${p.kind || 'unknown'}  |  Last active: ${timeAgo(p.lastActiveAt)}${daemonInfo}`,
    )
    if (p.tags && p.tags.length > 0) {
      console.log(`    Tags: ${p.tags.join(', ')}`)
    }
    console.log('')
  }

  console.log(
    '  Legend: \x1b[32m●\x1b[0m daemon running  \x1b[33m○\x1b[0m initialized  \x1b[31m✗\x1b[0m not found',
  )
}

// ---------------------------------------------------------------------------
// project add
// ---------------------------------------------------------------------------

async function projectAdd(
  targetPath: string | undefined,
  opts: {
    name?: string
    tag?: string[]
    port?: string
  },
): Promise<void> {
  const path = resolve(targetPath || process.cwd())

  const existing = await getProject(path)
  if (existing) {
    console.log(`Project already registered: ${existing.name} (${existing.path})`)
    // Touch to update lastActiveAt
    await touchProject(path)
    return
  }

  // Auto-detect project info
  let kind: string | undefined
  try {
    const { detectProject } = await import('../init/detect.js')
    const profile = await detectProject(path)
    kind = profile.kind
  } catch {
    /* detection is optional */
  }

  const dirName = path.split('/').pop() || path
  const entry = await registerProject(path, {
    name: opts.name || dirName,
    kind,
    daemonPort: opts.port ? parseInt(opts.port) : undefined,
    tags: opts.tag,
  })

  console.log(`Project registered: ${entry.name}`)
  console.log(`  Path: ${entry.path}`)
  console.log(`  Kind: ${entry.kind || 'unknown'}`)
  if (entry.tags && entry.tags.length > 0) {
    console.log(`  Tags: ${entry.tags.join(', ')}`)
  }
}

// ---------------------------------------------------------------------------
// project remove
// ---------------------------------------------------------------------------

async function projectRemove(targetPath: string | undefined): Promise<void> {
  const path = resolve(targetPath || process.cwd())
  const removed = await unregisterProject(path)

  if (removed) {
    console.log(`Project unregistered: ${path}`)
    console.log('Note: project files are not deleted, only removed from the registry.')
  } else {
    console.log(`Project not found in registry: ${path}`)
  }
}

// ---------------------------------------------------------------------------
// project status
// ---------------------------------------------------------------------------

async function projectStatus(targetPath: string | undefined): Promise<void> {
  const path = resolve(targetPath || process.cwd())
  const entry = await getProject(path)

  if (!entry) {
    console.log(`Project not registered: ${path}`)
    console.log('Run `ao project add` to register it.')
    return
  }

  const isInitialized = await isOrchestraProject(entry.path)
  const daemonAlive = entry.daemonPort ? await checkDaemonAlive(entry.daemonPort) : false

  console.log(`\nProject: ${entry.name}`)
  console.log(`  Path: ${entry.path}`)
  console.log(`  Kind: ${entry.kind || 'unknown'}`)
  console.log(`  Registered: ${formatDate(entry.registeredAt)}`)
  console.log(`  Last active: ${formatDate(entry.lastActiveAt)} (${timeAgo(entry.lastActiveAt)})`)
  console.log(`  Initialized: ${isInitialized ? 'yes' : 'no'}`)

  if (entry.daemonPort) {
    console.log(`  Daemon port: ${entry.daemonPort}`)
    console.log(
      `  Daemon status: ${daemonAlive ? '\x1b[32mrunning\x1b[0m' : '\x1b[31mstopped\x1b[0m'}`,
    )
    if (daemonAlive) {
      console.log(`  Dashboard: http://localhost:${entry.daemonPort}/`)
    }
  } else {
    console.log(`  Daemon: not configured`)
  }

  if (entry.tags && entry.tags.length > 0) {
    console.log(`  Tags: ${entry.tags.join(', ')}`)
  }
  if (entry.notes) {
    console.log(`  Notes: ${entry.notes}`)
  }

  // Count local data
  if (isInitialized) {
    const { readdir } = await import('node:fs/promises')
    const baseDir = join(entry.path, '.agent-orchestra')

    const countDir = async (dir: string): Promise<number> => {
      try {
        const entries = await readdir(join(baseDir, dir))
        return entries.filter((e) => e.endsWith('.json')).length
      } catch {
        return 0
      }
    }

    const [jobs, runs, tasks, automations] = await Promise.all([
      countDir('jobs'),
      countDir('runs'),
      countDir('tasks'),
      countDir('automation'),
    ])

    console.log(`\n  Data:`)
    console.log(`    Review jobs: ${jobs}`)
    console.log(`    Runs: ${runs}`)
    console.log(`    Tasks: ${tasks}`)
    console.log(`    Automation jobs: ${automations}`)
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectCommand(program: Command): void {
  const project = program
    .command('project')
    .description('Manage tracked projects across workspaces')

  project
    .command('list')
    .description('List all registered projects with status')
    .action(handleErrors(projectList))

  project
    .command('add [path]')
    .description('Register a project (defaults to current directory)')
    .option('--name <name>', 'Display name for the project')
    .option('--tag <tag...>', 'Tags for grouping')
    .option('--port <port>', 'Daemon port')
    .action(handleErrors(projectAdd))

  project
    .command('remove [path]')
    .description('Unregister a project (does not delete files)')
    .action(handleErrors(projectRemove))

  project
    .command('status [path]')
    .description('Show detailed status for a project')
    .action(handleErrors(projectStatus))
}
