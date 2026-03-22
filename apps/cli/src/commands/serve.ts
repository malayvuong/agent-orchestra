import type { Command } from 'commander'
import { resolve } from 'node:path'

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
// Serve command implementation
// ---------------------------------------------------------------------------

async function runServe(opts: { mcp: boolean; transport: string; path: string }): Promise<void> {
  if (!opts.mcp) {
    console.error('Please specify a server mode. Currently supported: --mcp')
    console.error('')
    console.error('Example:')
    console.error('  agent-orchestra serve --mcp')
    process.exit(1)
  }

  const workspacePath = resolve(opts.path)

  if (opts.transport === 'stdio') {
    const { startStdioServer } = await import('../mcp/server.js')
    await startStdioServer(workspacePath)
  } else {
    console.error(`Unsupported transport: ${opts.transport}. Currently supported: stdio`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start Agent Orchestra as a server')
    .option('--mcp', 'Start as an MCP tool server', false)
    .option('--transport <mode>', 'Transport mode: stdio', 'stdio')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (opts: { mcp: boolean; transport: string; path: string }) => {
        await runServe(opts)
      }),
    )
}
