import type { Command } from 'commander'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { PolicyEngine, loadPolicyConfig, SYSTEM_RULES } from '@malayvuong/agent-orchestra-core'
import type { CapabilityScope } from '@malayvuong/agent-orchestra-core'

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
// Command: policy show
// ---------------------------------------------------------------------------

async function runPolicyShow(opts: { path: string }): Promise<void> {
  const policy = await loadPolicyConfig(opts.path)

  console.log('\nActive Policy Configuration:')
  console.log(`  Default action: ${policy.defaultAction}`)
  console.log(`  Max execution: ${policy.maxExecutionMs}ms`)
  console.log(`  Network allowed: ${policy.networkAllowed}`)

  if (policy.rules.length > 0) {
    console.log(`\n  Rules (${policy.rules.length}):`)
    for (const rule of policy.rules) {
      const scope = rule.scope ? ` [${rule.scope.join(', ')}]` : ' [all]'
      console.log(`    ${rule.action.padEnd(16)} ${rule.capability}${scope}`)
    }
  } else {
    console.log('\n  Rules: (none — all capabilities denied by default)')
  }

  console.log(`\n  System rules (non-overridable): ${SYSTEM_RULES.length}`)
  for (const rule of SYSTEM_RULES) {
    console.log(`    DENY  ${rule.capability}  ${rule.reason}`)
  }

  const configPath = join(opts.path, '.agent-orchestra', 'policy.yaml')
  let configExists = true
  try {
    await readFile(configPath, 'utf-8')
  } catch {
    configExists = false
  }

  console.log(
    `\n  Config file: ${configPath} ${configExists ? '(found)' : '(not found — using defaults)'}`,
  )
}

// ---------------------------------------------------------------------------
// Command: policy eval
// ---------------------------------------------------------------------------

async function runPolicyEval(opts: {
  capability: string
  scope?: string
  path: string
}): Promise<void> {
  const policy = await loadPolicyConfig(opts.path)
  const engine = new PolicyEngine()

  const capability = opts.capability as CapabilityScope['capability']
  const scope = opts.scope ? opts.scope.split(',') : []

  const evaluation = engine.evaluate(capability, scope, policy)

  console.log(`\nPolicy evaluation for: ${capability}`)
  if (scope.length > 0) {
    console.log(`  Scope: ${scope.join(', ')}`)
  }
  console.log(`  Action: ${evaluation.action}`)
  console.log(`  Reason: ${evaluation.reason}`)
  if (evaluation.matchedRule) {
    const r = evaluation.matchedRule
    console.log(
      `  Matched rule: ${r.action} ${r.capability} ${r.scope ? `[${r.scope.join(', ')}]` : '[all]'}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Command: policy init
// ---------------------------------------------------------------------------

async function runPolicyInit(opts: { path: string }): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const configDir = join(opts.path, '.agent-orchestra')
  const configPath = join(configDir, 'policy.yaml')

  // Check if file already exists
  try {
    await readFile(configPath, 'utf-8')
    console.error(`Policy config already exists at ${configPath}`)
    console.error('Remove it first if you want to reinitialize.')
    process.exit(1)
  } catch {
    // File doesn't exist — good
  }

  const template = `# Agent Orchestra — Skill Policy Configuration
# See docs/skills/policy.md for details.
#
# IMPORTANT: defaultAction is always 'deny' (non-negotiable).
# Skills must have explicit rules to be granted capabilities.

defaultAction: deny
maxExecutionMs: 30000
networkAllowed: false

rules:
  # Allow read access to source and test files
  - capability: fs.read
    action: allow
    scope:
      - "./src/**"
      - "./tests/**"
      - "./package.json"

  # Require approval for write access
  - capability: fs.write
    action: require_approval
    scope:
      - "./src/**"

  # Allow specific safe commands
  # - capability: proc.spawn
  #   action: allow
  #   scope:
  #     - "npm test"
  #     - "npm run lint"

  # Network access is denied by default.
  # Uncomment and scope to specific domains if needed:
  # - capability: net.http
  #   action: require_approval
  #   scope:
  #     - "api.example.com"
`

  await mkdir(configDir, { recursive: true })
  await writeFile(configPath, template, 'utf-8')
  console.log(`Created policy config at ${configPath}`)
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPolicyCommand(program: Command): void {
  const policy = program.command('policy').description('Manage skill capability policies')

  policy
    .command('show')
    .description('Show the active policy configuration')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (opts: { path: string }) => {
        await runPolicyShow(opts)
      }),
    )

  policy
    .command('eval')
    .description('Evaluate a capability against the active policy')
    .requiredOption(
      '--capability <cap>',
      'Capability to evaluate (fs.read, fs.write, net.http, proc.spawn, secrets.read)',
    )
    .option('--scope <scopes>', 'Comma-separated scopes to evaluate')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (opts: { capability: string; scope?: string; path: string }) => {
        await runPolicyEval(opts)
      }),
    )

  policy
    .command('init')
    .description('Create a default policy.yaml configuration')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (opts: { path: string }) => {
        await runPolicyInit(opts)
      }),
    )
}
