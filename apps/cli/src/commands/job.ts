import type { Command } from 'commander'
import { resolve, join } from 'node:path'
import { FileJobStore, FileRoundStore } from '@malayvuong/agent-orchestra-core'
import type { Job, Round } from '@malayvuong/agent-orchestra-core'
import { buildRunComparison, selectComparableJobs } from '../jobs/compare-runs.js'

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

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatStatus(status: Job['status']): string {
  const labels: Record<Job['status'], string> = {
    draft: 'DRAFT',
    queued: 'QUEUED',
    running: 'RUNNING',
    awaiting_decision: 'AWAITING',
    completed: 'DONE',
    cancelled: 'CANCELLED',
    failed: 'FAILED',
  }
  return labels[status] ?? status
}

function formatDate(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleString()
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

// ---------------------------------------------------------------------------
// Command: job list
// ---------------------------------------------------------------------------

async function runJobList(opts: { path: string }): Promise<void> {
  const baseDir = join(resolve(opts.path), STORAGE_DIR_NAME)
  const jobStore = new FileJobStore(baseDir)

  const jobs = await jobStore.list()

  if (jobs.length === 0) {
    console.log('No jobs found.')
    return
  }

  // Sort by createdAt descending (newest first)
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  console.log(`\nJobs (${jobs.length}):`)
  console.log('')

  const idWidth = 10
  const statusWidth = 12
  const protocolWidth = 20
  const titleWidth = 40

  const header =
    'ID'.padEnd(idWidth) +
    'STATUS'.padEnd(statusWidth) +
    'PROTOCOL'.padEnd(protocolWidth) +
    'TITLE'.padEnd(titleWidth) +
    'CREATED'
  console.log(`  ${header}`)
  console.log(`  ${''.padEnd(header.length, '-')}`)

  for (const job of jobs) {
    const shortId = job.id.slice(0, 8)
    const status = formatStatus(job.status)
    const protocol = job.protocol
    const title = truncate(job.title, titleWidth - 2)
    const created = formatDate(job.createdAt)

    console.log(
      `  ${shortId.padEnd(idWidth)}${status.padEnd(statusWidth)}${protocol.padEnd(protocolWidth)}${title.padEnd(titleWidth)}${created}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Command: job show <id>
// ---------------------------------------------------------------------------

async function runJobShow(jobId: string, opts: { path: string }): Promise<void> {
  const baseDir = join(resolve(opts.path), STORAGE_DIR_NAME)
  const jobStore = new FileJobStore(baseDir)
  const roundStore = new FileRoundStore(baseDir)

  // Support partial ID matching (first 8 chars)
  let job: Job | undefined

  if (jobId.length < 36) {
    // Partial ID — scan and match
    const allJobs = await jobStore.list()
    const matches = allJobs.filter((j) => j.id.startsWith(jobId))

    if (matches.length === 0) {
      console.error(`No job found matching ID prefix: ${jobId}`)
      process.exit(1)
    }
    if (matches.length > 1) {
      console.error(`Ambiguous ID prefix "${jobId}" matches ${matches.length} jobs:`)
      for (const m of matches) {
        console.error(`  ${m.id} — ${m.title}`)
      }
      process.exit(1)
    }
    job = matches[0]
  } else {
    job = await jobStore.load(jobId)
  }

  if (!job) {
    console.error(`Job not found: ${jobId}`)
    process.exit(1)
  }

  // Display job details
  console.log(`\nJob: ${job.id}`)
  console.log(`Title: ${job.title}`)
  console.log(`Status: ${formatStatus(job.status)}`)
  console.log(`Protocol: ${job.protocol}`)
  console.log(`Mode: ${job.mode}`)
  console.log(`Created: ${formatDate(job.createdAt)}`)
  console.log(`Updated: ${formatDate(job.updatedAt)}`)

  // Agents
  console.log(`\nAgents (${job.agents.length}):`)
  for (const agent of job.agents) {
    const lens = agent.lens ? ` [${agent.lens}]` : ''
    console.log(
      `  ${agent.id}: ${agent.role}${lens} (${agent.providerKey}/${agent.modelOrCommand})`,
    )
  }

  // Target resolution (when present)
  const tr = (job as Record<string, unknown>).targetResolution as
    | {
        entryTarget?: string
        entryKind?: string
        resolvedFiles?: string[]
        discovery?: Array<{ reason: string }>
      }
    | undefined

  if (tr) {
    const entryLabel = tr.entryTarget ?? '(unknown)'
    const fileCount = tr.resolvedFiles?.length ?? 0
    const discoveryCounts: Record<string, number> = {}
    if (tr.discovery) {
      for (const d of tr.discovery) {
        discoveryCounts[d.reason] = (discoveryCounts[d.reason] ?? 0) + 1
      }
    }

    console.log(`\nTarget resolution:`)
    console.log(`  Entry: ${entryLabel} (${tr.entryKind ?? 'unknown'})`)
    console.log(`  Resolved: ${fileCount} file(s)`)
    if (Object.keys(discoveryCounts).length > 0) {
      const parts = Object.entries(discoveryCounts).map(([reason, count]) => `${reason}: ${count}`)
      console.log(`  Discovery: ${parts.join(', ')}`)
    }
  }

  const baselineSnapshot = (job as Record<string, unknown>).baselineSnapshot as
    | {
        fingerprint?: string
        files?: Array<unknown>
      }
    | undefined

  if (baselineSnapshot) {
    console.log(`\nBaseline:`)
    console.log(`  Fingerprint: ${baselineSnapshot.fingerprint ?? '(unknown)'}`)
    console.log(`  Files: ${baselineSnapshot.files?.length ?? 0}`)
  }

  // Scope
  console.log(`\nScope:`)
  console.log(`  Primary targets: ${job.scope.primaryTargets.length} file(s)`)
  for (const target of job.scope.primaryTargets.slice(0, 5)) {
    console.log(`    ${target}`)
  }
  if (job.scope.primaryTargets.length > 5) {
    console.log(`    ... and ${job.scope.primaryTargets.length - 5} more`)
  }

  // Rounds
  const rounds = await roundStore.listByJob(job.id)

  console.log(`\nRounds (${rounds.length}):`)
  if (rounds.length === 0) {
    console.log('  (no rounds yet)')
  } else {
    for (const round of rounds) {
      if (round.state === 'apply' && round.applySummary) {
        const as = round.applySummary
        console.log(
          `  Round ${round.index}: apply — wrote ${as.writtenFiles.length} file(s), unchanged ${as.unchangedFiles.length}, skipped ${as.skippedFiles.length}`,
        )
      } else if (round.state === 'final_check' && round.finalCheckSummary) {
        const summary = round.finalCheckSummary
        const scoreText = summary.score !== undefined ? `, score ${summary.score}` : ''
        console.log(`  Round ${round.index}: final_check — ${summary.verdict}${scoreText}`)
      } else {
        const findingCount =
          (round.architectOutput?.findings.length ?? 0) +
          round.reviewerOutputs.reduce((sum, r) => sum + r.output.findings.length, 0)

        console.log(`  Round ${round.index}: ${round.state} — ${findingCount} finding(s)`)
      }
    }
  }
}

async function runJobCompare(jobId: string, opts: { path: string }): Promise<void> {
  const baseDir = join(resolve(opts.path), STORAGE_DIR_NAME)
  const jobStore = new FileJobStore(baseDir)
  const roundStore = new FileRoundStore(baseDir)

  const allJobs = await jobStore.list()
  const anchorJob = allJobs.find((job) => job.id.startsWith(jobId))
  if (!anchorJob) {
    console.error(`No job found matching ID prefix: ${jobId}`)
    process.exit(1)
  }

  const relatedJobs = selectComparableJobs(anchorJob, allJobs)
  const roundsByJob = new Map<string, Round[]>()
  for (const job of relatedJobs) {
    roundsByJob.set(job.id, await roundStore.listByJob(job.id))
  }

  const comparison = buildRunComparison(anchorJob, relatedJobs, roundsByJob)

  console.log(`\nComparable runs:`)
  console.log(`  Basis: ${comparison.basis}`)
  if (comparison.baselineFingerprint) {
    console.log(`  Baseline fingerprint: ${comparison.baselineFingerprint}`)
  }
  if (comparison.entryTarget) {
    console.log(`  Entry target: ${comparison.entryTarget}`)
  }
  if (comparison.bestRunId) {
    console.log(`  Best run: ${comparison.bestRunId}`)
  }

  for (const run of comparison.runs) {
    const verdict = run.finalVerdict ?? 'n/a'
    const score = run.finalScore ?? 'n/a'
    console.log(
      `  ${run.jobId.slice(0, 12)}  findings=${run.convergenceFindings}  wrote=${run.applyWrittenFiles}  verdict=${verdict}  score=${score}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerJobCommand(program: Command): void {
  const job = program.command('job').description('Manage review jobs')

  job
    .command('list')
    .description('List all jobs')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (opts: { path: string }) => {
        await runJobList(opts)
      }),
    )

  job
    .command('show <id>')
    .description('Show job details')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (jobId: string, opts: { path: string }) => {
        await runJobShow(jobId, opts)
      }),
    )

  job
    .command('compare <id>')
    .description('Compare runs that share the same baseline or entry target')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (jobId: string, opts: { path: string }) => {
        await runJobCompare(jobId, opts)
      }),
    )
}
