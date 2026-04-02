import type { Command } from 'commander'
import { resolve, join } from 'node:path'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { detectProject } from '../init/detect.js'
import { registerProject } from '@malayvuong/agent-orchestra-core'

const STORAGE_DIR_NAME = '.agent-orchestra'

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

// ─── Interactive prompt helpers ──────────────────────────────────

function createPrompt() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return {
    ask(question: string, defaultVal?: string): Promise<string> {
      const suffix = defaultVal ? ` [${defaultVal}]` : ''
      return new Promise((resolve) => {
        rl.question(`  ${question}${suffix}: `, (answer) => {
          resolve(answer.trim() || defaultVal || '')
        })
      })
    },
    choose(question: string, options: string[], defaultIndex = 0): Promise<string> {
      return new Promise((resolve) => {
        console.log(`  ${question}`)
        options.forEach((opt, i) => {
          const marker = i === defaultIndex ? '>' : ' '
          console.log(`    ${marker} ${i + 1}. ${opt}`)
        })
        rl.question(`  Choice [${defaultIndex + 1}]: `, (answer) => {
          const idx = parseInt(answer.trim()) - 1
          const chosen =
            options[Number.isNaN(idx) || idx < 0 || idx >= options.length ? defaultIndex : idx]
          resolve(chosen)
        })
      })
    },
    confirm(question: string, defaultYes = true): Promise<boolean> {
      const hint = defaultYes ? 'Y/n' : 'y/N'
      return new Promise((resolve) => {
        rl.question(`  ${question} (${hint}): `, (answer) => {
          const a = answer.trim().toLowerCase()
          if (a === '') resolve(defaultYes)
          else resolve(a === 'y' || a === 'yes')
        })
      })
    },
    close() {
      rl.close()
    },
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile() || s.isDirectory()
  } catch {
    return false
  }
}

// ─── Setup wizard ────────────────────────────────────────────────

async function runSetup(opts: { path: string }): Promise<void> {
  const workspacePath = resolve(opts.path)
  const baseDir = join(workspacePath, STORAGE_DIR_NAME)

  console.log('')
  console.log('  ╔══════════════════════════════════════╗')
  console.log('  ║     Agent Orchestra Setup Wizard     ║')
  console.log('  ╚══════════════════════════════════════╝')
  console.log('')

  const prompt = createPrompt()

  try {
    // ── Step 1: Detect project ─────────────────────────────
    console.log('  Step 1/5: Detecting project...')
    const profile = await detectProject(workspacePath)
    console.log(`  Detected: ${profile.kind} project`)
    if (profile.hasTests) console.log('  Tests: found')
    if (profile.hasDocs) console.log('  Docs: found')
    if (profile.recommendedSuperpowers.length > 0) {
      console.log(`  Recommended superpowers: ${profile.recommendedSuperpowers.join(', ')}`)
    }
    console.log('')

    // ── Step 2: Provider selection ─────────────────────────
    console.log('  Step 2/5: Provider configuration')
    const provider = await prompt.choose(
      'Select your default AI provider:',
      [
        'claude-cli — Claude Code CLI (recommended if installed)',
        'codex-cli — OpenAI Codex CLI',
        'anthropic — Anthropic API (requires ANTHROPIC_API_KEY)',
        'openai — OpenAI API (requires OPENAI_API_KEY)',
        'auto — auto-detect available providers',
      ],
      4,
    )
    const providerKey = provider.split(' ')[0]
    console.log(`  Selected: ${providerKey}`)
    console.log('')

    // ── Step 3: Configure review defaults ──────────────────
    console.log('  Step 3/5: Review defaults')
    const defaultLens = await prompt.choose(
      'Default review lens:',
      [
        'logic — general logic and correctness',
        'security — security-focused review',
        'performance — performance analysis',
        'testing — test coverage and quality',
        'scope — scope and requirements alignment',
      ],
      0,
    )
    const lensKey = defaultLens.split(' ')[0]

    const maxRounds = await prompt.ask('Max review rounds', '10')
    const autoApply = await prompt.confirm('Enable auto-apply by default?', false)
    console.log('')

    // ── Step 4: Automation setup ───────────────────────────
    console.log('  Step 4/5: Automation')
    const setupAutomation = await prompt.confirm('Set up sample automation jobs?', true)

    const sampleJobs: SampleJob[] = []
    if (setupAutomation) {
      if (profile.hasTests) {
        const addTestJob = await prompt.confirm(
          'Add "test runner" automation (runs your test suite)?',
          true,
        )
        if (addTestJob) {
          const testCmd =
            profile.kind === 'node-ts'
              ? 'npm test'
              : profile.kind === 'python'
                ? 'pytest'
                : profile.kind === 'rust'
                  ? 'cargo test'
                  : 'make test'
          const cmd = await prompt.ask('Test command', testCmd)
          sampleJobs.push({
            id: 'test-runner',
            name: 'Test Runner',
            schedule: 'every 1h',
            command: cmd,
          })
        }
      }

      const addHealthCheck = await prompt.confirm(
        'Add "health check" automation (basic project health)?',
        true,
      )
      if (addHealthCheck) {
        const healthCmd =
          profile.kind === 'node-ts'
            ? 'npm run build'
            : profile.kind === 'python'
              ? 'python -c "import sys; print(sys.version)"'
              : profile.kind === 'rust'
                ? 'cargo check'
                : 'echo ok'
        sampleJobs.push({
          id: 'health-check',
          name: 'Health Check',
          schedule: 'every 6h',
          command: healthCmd,
        })
      }
    }
    console.log('')

    // ── Step 5: Daemon ─────────────────────────────────────
    console.log('  Step 5/5: Daemon & Dashboard')
    const startDaemon = await prompt.confirm('Start the dashboard daemon after setup?', true)
    const daemonPort = startDaemon ? await prompt.ask('Dashboard port', '3100') : '3100'
    console.log('')

    // ── Apply configuration ────────────────────────────────
    console.log('  Applying configuration...')
    console.log('')

    // Create directories
    await mkdir(baseDir, { recursive: true })
    await mkdir(join(baseDir, 'automation'), { recursive: true })
    await mkdir(join(baseDir, 'runs'), { recursive: true })
    await mkdir(join(baseDir, 'tasks'), { recursive: true })
    await mkdir(join(baseDir, 'sessions'), { recursive: true })
    await mkdir(join(baseDir, 'daemon'), { recursive: true })

    // Write agents config
    const agentsYaml = [
      `# Agent Orchestra — agent configuration`,
      `# Generated by ao setup`,
      ``,
      `architect:`,
      `  provider: ${providerKey}`,
      `  # model: (uses provider default)`,
      ``,
      `reviewer:`,
      `  provider: ${providerKey}`,
      `  lens: ${lensKey}`,
      `  # model: (uses provider default)`,
      ``,
      `# defaults:`,
      `#   maxRounds: ${maxRounds}`,
      `#   autoApply: ${autoApply}`,
    ].join('\n')

    const agentsPath = join(baseDir, 'agents.yaml')
    if (await fileExists(agentsPath)) {
      const overwrite = await prompt.confirm('agents.yaml already exists. Overwrite?', false)
      if (overwrite) {
        await writeFile(agentsPath, agentsYaml + '\n')
        console.log('  Updated: agents.yaml')
      } else {
        console.log('  Skipped: agents.yaml (kept existing)')
      }
    } else {
      await writeFile(agentsPath, agentsYaml + '\n')
      console.log('  Created: agents.yaml')
    }

    // Write setup config
    const setupConfig = {
      provider: providerKey,
      lens: lensKey,
      maxRounds: parseInt(maxRounds),
      autoApply,
      daemonPort: parseInt(daemonPort),
      createdAt: new Date().toISOString(),
    }
    await writeFile(join(baseDir, 'setup.json'), JSON.stringify(setupConfig, null, 2) + '\n')
    console.log('  Created: setup.json')

    // Register project in central registry
    await registerProject(workspacePath, {
      kind: profile.kind,
      daemonPort: parseInt(daemonPort),
    })
    console.log('  Registered: project in ~/.agent-orchestra/projects.json')

    // Write sample automation jobs
    for (const job of sampleJobs) {
      const jobDef = {
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        trigger: 'cron',
        enabled: true,
        createdAt: Date.now(),
        workflow: [
          {
            id: 'step-1',
            type: 'script',
            name: job.name,
            config: { command: job.command },
            timeoutMs: 60_000,
          },
        ],
      }
      await writeFile(
        join(baseDir, 'automation', `${job.id}.json`),
        JSON.stringify(jobDef, null, 2) + '\n',
      )
      console.log(`  Created: automation/${job.id}.json (${job.schedule})`)
    }

    console.log('')

    // ── Start daemon ───────────────────────────────────────
    if (startDaemon) {
      console.log('  Starting daemon...')
      try {
        // Import and run daemon start programmatically
        const { spawn: spawnProcess } = await import('node:child_process')
        const aoPath = process.argv[1]
        const child = spawnProcess(
          process.execPath,
          [aoPath, 'daemon', 'start', '--port', daemonPort, '--path', workspacePath],
          {
            stdio: 'inherit',
          },
        )
        await new Promise<void>((resolve, reject) => {
          child.on('close', (code) => {
            if (code === 0) resolve()
            else reject(new Error(`daemon start exited with code ${code}`))
          })
        })
      } catch {
        console.log(`  Could not start daemon automatically.`)
        console.log(`  Run manually: ao daemon start --port ${daemonPort}`)
      }
    }

    // ── Summary ────────────────────────────────────────────
    console.log('')
    console.log('  ╔══════════════════════════════════════╗')
    console.log('  ║          Setup Complete!             ║')
    console.log('  ╚══════════════════════════════════════╝')
    console.log('')
    console.log('  Quick start:')
    console.log('')
    console.log('    Review a file:')
    console.log(`    ao run --target ./your-file.md --superpower plan-review`)
    console.log('')
    if (sampleJobs.length > 0) {
      console.log('    Run automation:')
      console.log(`    ao automation run ${sampleJobs[0].id}`)
      console.log('')
    }
    if (startDaemon) {
      console.log('    Dashboard:')
      console.log(`    http://localhost:${daemonPort}/`)
      console.log('')
    }
    console.log('    Manage daemon:')
    console.log('    ao daemon status / ao daemon stop / ao daemon logs')
    console.log('')
  } finally {
    prompt.close()
  }
}

type SampleJob = {
  id: string
  name: string
  schedule: string
  command: string
}

// ─── Registration ────────────────────────────────────────────────

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Interactive setup wizard — configure providers, automation, and dashboard')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(handleErrors(runSetup))
}
