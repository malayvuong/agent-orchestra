import type { Command } from 'commander'
import { resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  FileRunStore,
  FileAutomationStore,
  AutomationRunner,
} from '@malayvuong/agent-orchestra-core'
import type {
  AutomationJobDefinition,
  StepExecutor,
  WorkflowStep,
} from '@malayvuong/agent-orchestra-core'

/** Base directory for agent-orchestra storage */
const STORAGE_DIR_NAME = '.agent-orchestra'

/** Wraps an async command handler with user-friendly error handling */
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

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function automationList(opts: { path: string }): Promise<void> {
  const baseDir = join(resolve(opts.path), STORAGE_DIR_NAME)
  const store = new FileAutomationStore(baseDir)
  const jobs = await store.list()

  if (jobs.length === 0) {
    console.log('No automation jobs found.')
    return
  }

  console.log(`\nAutomation jobs (${jobs.length}):\n`)

  const idW = 12
  const nameW = 24
  const schedW = 16
  const statusW = 10

  const header =
    'ID'.padEnd(idW) +
    'NAME'.padEnd(nameW) +
    'SCHEDULE'.padEnd(schedW) +
    'ENABLED'.padEnd(statusW) +
    'LAST RUN'
  console.log(`  ${header}`)
  console.log(`  ${''.padEnd(header.length, '-')}`)

  for (const job of jobs) {
    const shortId = job.id.slice(0, 10)
    const name = job.name.length > nameW - 2 ? job.name.slice(0, nameW - 5) + '...' : job.name
    const sched = job.schedule ?? '-'
    const enabled = job.enabled ? 'yes' : 'no'
    const lastRun = job.lastRunAt
      ? `${formatDate(job.lastRunAt)} (${job.lastRunStatus ?? '?'})`
      : '-'

    console.log(
      `  ${shortId.padEnd(idW)}${name.padEnd(nameW)}${sched.padEnd(schedW)}${enabled.padEnd(statusW)}${lastRun}`,
    )
  }
}

async function automationAdd(file: string, opts: { path: string }): Promise<void> {
  const baseDir = join(resolve(opts.path), STORAGE_DIR_NAME)
  const store = new FileAutomationStore(baseDir)

  const raw = await readFile(resolve(file), 'utf-8')
  let jobDef: AutomationJobDefinition

  if (file.endsWith('.json')) {
    jobDef = JSON.parse(raw) as AutomationJobDefinition
  } else {
    // For YAML support, a parser dependency would be needed. MVP: JSON only.
    throw new Error('Only .json job definitions are supported in MVP. YAML support coming later.')
  }

  if (!jobDef.id || !jobDef.name || !jobDef.workflow) {
    throw new Error('Job definition must include id, name, and workflow fields.')
  }

  // Set defaults
  jobDef.createdAt = jobDef.createdAt || Date.now()
  jobDef.enabled = jobDef.enabled !== false

  await store.save(jobDef)
  console.log(`Automation job registered: ${jobDef.id} (${jobDef.name})`)

  if (jobDef.schedule) {
    console.log(`Schedule: ${jobDef.schedule}`)
  }
  console.log(`Steps: ${jobDef.workflow.length}`)
}

async function automationRun(jobId: string, opts: { path: string }): Promise<void> {
  const baseDir = join(resolve(opts.path), STORAGE_DIR_NAME)
  const automationStore = new FileAutomationStore(baseDir)
  const runStore = new FileRunStore(baseDir)

  const job = await automationStore.load(jobId)
  if (!job) {
    // Try prefix match
    const all = await automationStore.list()
    const matches = all.filter((j) => j.id.startsWith(jobId))
    if (matches.length === 0) {
      throw new Error(`Automation job not found: ${jobId}`)
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous ID prefix "${jobId}" matches ${matches.length} jobs`)
    }
    return automationRun(matches[0].id, opts)
  }

  console.log(`Running automation: ${job.name} (${job.id})`)
  console.log(`Steps: ${job.workflow.length}\n`)

  // Build a basic script step executor for MVP
  const executors = new Map<string, StepExecutor>()
  executors.set('script', {
    async execute(step: WorkflowStep) {
      const { execSync } = await import('node:child_process')
      const command = step.config['command'] as string
      if (!command) throw new Error('Script step requires config.command')
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: step.timeoutMs ?? 30_000,
        cwd: resolve(opts.path),
      })
      return { summary: output.trim().slice(0, 200) }
    },
  })

  const runner = new AutomationRunner(runStore, executors)

  const result = await runner.execute(
    {
      source: 'system',
      sessionId: `automation-${job.id}`,
      actorId: 'cli',
      trustedMeta: { automationJob: job },
      requestedMode: 'automation',
    },
    {
      sessionId: `automation-${job.id}`,
      sessionType: 'cron',
      owner: 'cli',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    },
  )

  // Update job last run info
  job.lastRunAt = Date.now()
  job.lastRunStatus = result.error ? 'failed' : 'ok'
  await automationStore.save(job)

  if (result.error) {
    console.error(`\nFailed: ${result.error}`)
    console.log(`Run ID: ${result.runRecord.runId}`)
    process.exit(1)
  }

  console.log(`\nCompleted successfully.`)
  console.log(`Run ID: ${result.runRecord.runId}`)
  console.log(`Tool calls: ${result.runRecord.toolCalls.length}`)

  if (result.artifacts && result.artifacts.length > 0) {
    console.log(`Artifacts: ${result.artifacts.length}`)
  }
}

async function automationToggle(
  jobId: string,
  enable: boolean,
  opts: { path: string },
): Promise<void> {
  const baseDir = join(resolve(opts.path), STORAGE_DIR_NAME)
  const store = new FileAutomationStore(baseDir)

  const job = await store.load(jobId)
  if (!job) throw new Error(`Automation job not found: ${jobId}`)

  job.enabled = enable
  await store.save(job)
  console.log(`Job ${jobId}: ${enable ? 'enabled' : 'disabled'}`)
}

async function automationLogs(jobId: string, opts: { path: string; limit: string }): Promise<void> {
  const baseDir = join(resolve(opts.path), STORAGE_DIR_NAME)
  const runStore = new FileRunStore(baseDir)

  const runs = await runStore.listBySession(`automation-${jobId}`)

  if (runs.length === 0) {
    console.log('No runs found for this automation job.')
    return
  }

  // Sort by startedAt descending
  runs.sort((a, b) => b.startedAt - a.startedAt)

  const limit = parseInt(opts.limit) || 10
  const shown = runs.slice(0, limit)

  console.log(`\nRun history for automation ${jobId} (showing ${shown.length}/${runs.length}):\n`)

  for (const run of shown) {
    const duration = run.endedAt ? `${run.endedAt - run.startedAt}ms` : 'running'
    const tools = run.toolCalls.length
    const status = run.status.toUpperCase()
    console.log(
      `  ${run.runId.slice(0, 8)}  ${status.padEnd(12)}${formatDate(run.startedAt)}  ${duration.padStart(8)}  ${tools} step(s)`,
    )
    if (run.failureReason) {
      console.log(`    Reason: ${run.failureReason.slice(0, 100)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAutomationCommand(program: Command): void {
  const auto = program.command('automation').description('Manage automation jobs')

  auto
    .command('list')
    .description('List all registered automation jobs')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(handleErrors(automationList))

  auto
    .command('add <file>')
    .description('Register an automation job from a JSON definition file')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(handleErrors(automationAdd))

  auto
    .command('run <jobId>')
    .description('Run an automation job immediately (isolated)')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(handleErrors(automationRun))

  auto
    .command('enable <jobId>')
    .description('Enable an automation job')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (jobId: string, opts: { path: string }) => {
        await automationToggle(jobId, true, opts)
      }),
    )

  auto
    .command('disable <jobId>')
    .description('Disable an automation job')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (jobId: string, opts: { path: string }) => {
        await automationToggle(jobId, false, opts)
      }),
    )

  auto
    .command('logs <jobId>')
    .description('Show run history for an automation job')
    .option('--path <path>', 'Workspace path', process.cwd())
    .option('--limit <n>', 'Max runs to show', '10')
    .action(handleErrors(automationLogs))
}
