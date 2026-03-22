import type { Command } from 'commander'
import { join } from 'node:path'
import { ToolAuditLogger } from '@malayvuong/agent-orchestra-core'

/** Simple logger that routes warnings to stderr */
const cliLogger = {
  warn: (msg: string) => console.error(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
}

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

function formatOutcome(outcome: string): string {
  switch (outcome) {
    case 'success':
      return 'OK'
    case 'failure':
      return 'FAIL'
    case 'timeout':
      return 'TIMEOUT'
    case 'denied':
      return 'DENIED'
    default:
      return outcome.toUpperCase()
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ---------------------------------------------------------------------------
// Command: audit
// ---------------------------------------------------------------------------

async function runAudit(opts: {
  job?: string
  skill?: string
  path: string
  verbose?: boolean
}): Promise<void> {
  const logDir = join(opts.path, '.agent-orchestra', 'audit')
  const auditLogger = new ToolAuditLogger(logDir, cliLogger)

  let entries: Awaited<ReturnType<typeof auditLogger.queryByJob>>

  if (opts.job) {
    entries = await auditLogger.queryByJob(opts.job)
  } else if (opts.skill) {
    entries = await auditLogger.queryBySkill(opts.skill)
  } else {
    // Show all entries
    console.log('Usage: audit --job <job-id> or audit --skill <skill-id>')
    console.log('\nExamples:')
    console.log('  agent-orchestra audit --job job-123')
    console.log('  agent-orchestra audit --skill dependency-audit')
    return
  }

  if (entries.length === 0) {
    const filter = opts.job ? `job '${opts.job}'` : `skill '${opts.skill}'`
    console.log(`No audit entries found for ${filter}.`)
    return
  }

  console.log(`\nAudit log (${entries.length} entries):\n`)

  for (const entry of entries) {
    const outcome = formatOutcome(entry.outcome).padEnd(7)
    const duration = formatDuration(entry.durationMs).padEnd(8)
    const skill = entry.skillId.padEnd(20)
    const tool = entry.toolName.padEnd(20)
    const timestamp = entry.timestamp.slice(0, 19).replace('T', ' ')

    console.log(`  ${timestamp}  ${outcome}  ${duration}  ${skill}  ${tool}`)

    if (opts.verbose) {
      console.log(`    Invocation: ${entry.invocationId}`)
      console.log(`    Args: ${JSON.stringify(entry.args)}`)
      if (entry.error) {
        console.log(`    Error: ${entry.error}`)
      }
      if (entry.result.truncated) {
        console.log(`    Result: (truncated from ${entry.result.originalSizeBytes} bytes)`)
      }
      console.log()
    }
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('Query tool invocation audit logs')
    .option('--job <job-id>', 'Filter by job ID')
    .option('--skill <skill-id>', 'Filter by skill ID')
    .option('--path <path>', 'Workspace path', process.cwd())
    .option('-v, --verbose', 'Show detailed entry information')
    .action(
      handleErrors(
        async (opts: { job?: string; skill?: string; path: string; verbose?: boolean }) => {
          await runAudit(opts)
        },
      ),
    )
}
