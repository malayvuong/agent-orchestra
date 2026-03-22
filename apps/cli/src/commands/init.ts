import type { Command } from 'commander'
import { resolve, join } from 'node:path'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { detectProject } from '../init/detect.js'
import {
  generateAgentsMd,
  generateAgentsSection,
  generatePolicyYaml,
  generateSkillsetsYaml,
} from '../init/generate.js'

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

/**
 * Check whether a file exists at the given path.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Init command implementation
// ---------------------------------------------------------------------------

async function runInit(opts: {
  path: string
  yes: boolean
  projectType?: string
  withPolicy: boolean
  withSkillsets: boolean
  force: boolean
}): Promise<void> {
  const rootPath = resolve(opts.path)
  const orchestraDir = join(rootPath, '.agent-orchestra')
  const agentsMdPath = join(rootPath, 'AGENTS.md')

  // Phase A: Project detection
  const profile = await detectProject(rootPath)

  // Allow manual override of project type
  if (opts.projectType) {
    const validKinds = ['node-ts', 'python', 'rust', 'generic']
    if (validKinds.includes(opts.projectType)) {
      profile.kind = opts.projectType as typeof profile.kind
    } else {
      console.error(`Unknown project type: ${opts.projectType}. Valid: ${validKinds.join(', ')}`)
      process.exit(1)
    }
  }

  // Print detection results
  console.log(`Detected project: ${profile.kind}`)
  if (profile.hasTests) console.log(`  Tests directory: found`)
  if (profile.hasDocs) console.log(`  Docs directory: found`)
  console.log(`Recommended superpowers:`)
  for (const sp of profile.recommendedSuperpowers) {
    console.log(`  - ${sp}`)
  }
  console.log('')

  // Phase A2: Provider detection
  const { detectCliProviders } = await import('@agent-orchestra/providers')
  const detected = await detectCliProviders()

  const apiKeys = {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    grok: !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY),
    deepseek: !!process.env.DEEPSEEK_API_KEY,
  }

  console.log('Providers detected:')
  if (detected.claudeCli) console.log('  [x] claude CLI')
  else console.log('  [ ] claude CLI (not found — install from https://claude.ai/download)')
  if (detected.codexCli) console.log('  [x] codex CLI')
  else console.log('  [ ] codex CLI (not found — npm i -g @openai/codex)')
  if (apiKeys.openai) console.log('  [x] OpenAI API (OPENAI_API_KEY)')
  else console.log('  [ ] OpenAI API (OPENAI_API_KEY not set)')
  if (apiKeys.anthropic) console.log('  [x] Anthropic API (ANTHROPIC_API_KEY)')
  else console.log('  [ ] Anthropic API (ANTHROPIC_API_KEY not set)')
  if (apiKeys.grok) console.log('  [x] Grok API (XAI_API_KEY)')
  if (apiKeys.deepseek) console.log('  [x] Deepseek API (DEEPSEEK_API_KEY)')

  const hasAnyProvider =
    detected.claudeCli ||
    detected.codexCli ||
    apiKeys.openai ||
    apiKeys.anthropic ||
    apiKeys.grok ||
    apiKeys.deepseek

  if (!hasAnyProvider) {
    console.log('')
    console.log('  No providers available. Install a CLI tool or set an API key:')
    console.log('    Option 1: Install Claude CLI → https://claude.ai/download')
    console.log('    Option 2: Install Codex CLI → npm i -g @openai/codex')
    console.log('    Option 3: export OPENAI_API_KEY=sk-...')
    console.log('    Option 4: export ANTHROPIC_API_KEY=sk-ant-...')
  }
  console.log('')

  const generated: string[] = []
  const skipped: string[] = []

  // Phase B: Create .agent-orchestra/ directory
  await mkdir(orchestraDir, { recursive: true })

  // Phase B2: Auto-generate agents.yaml based on detected providers
  const agentsYamlPath = join(orchestraDir, 'agents.yaml')
  const agentsYamlExists = await fileExists(agentsYamlPath)

  if (agentsYamlExists && !opts.force) {
    skipped.push('.agent-orchestra/agents.yaml (already exists)')
  } else if (hasAnyProvider) {
    const agentsYaml = buildAgentsYaml(detected, apiKeys)
    await writeFile(agentsYamlPath, agentsYaml, 'utf-8')
    generated.push('.agent-orchestra/agents.yaml')
  }

  // Generate policy.yaml if requested
  if (opts.withPolicy) {
    const policyPath = join(orchestraDir, 'policy.yaml')
    const policyExists = await fileExists(policyPath)

    if (policyExists && !opts.force) {
      skipped.push('.agent-orchestra/policy.yaml (already exists)')
    } else {
      const content = generatePolicyYaml(profile)
      await writeFile(policyPath, content, 'utf-8')
      generated.push('.agent-orchestra/policy.yaml')
    }
  }

  // Generate skillsets.yaml if requested
  if (opts.withSkillsets) {
    const skillsetsPath = join(orchestraDir, 'skillsets.yaml')
    const skillsetsExists = await fileExists(skillsetsPath)

    if (skillsetsExists && !opts.force) {
      skipped.push('.agent-orchestra/skillsets.yaml (already exists)')
    } else {
      const content = generateSkillsetsYaml(profile)
      await writeFile(skillsetsPath, content, 'utf-8')
      generated.push('.agent-orchestra/skillsets.yaml')
    }
  }

  // Phase C: Generate AGENTS.md
  const agentsMdExists = await fileExists(agentsMdPath)

  if (agentsMdExists && !opts.force) {
    // Check if it already has Agent Orchestra content
    const existingContent = await readFile(agentsMdPath, 'utf-8')
    const hasOrchestra =
      existingContent.includes('Agent Orchestra') || existingContent.includes('agent-orchestra')

    if (hasOrchestra) {
      skipped.push('AGENTS.md (already contains Agent Orchestra section)')
    } else {
      // Append Agent Orchestra section to existing file
      const section = generateAgentsSection(profile)
      await writeFile(agentsMdPath, existingContent.trimEnd() + '\n' + section, 'utf-8')
      generated.push('AGENTS.md (appended Agent Orchestra section)')
    }
  } else if (agentsMdExists && opts.force) {
    const content = generateAgentsMd(profile)
    await writeFile(agentsMdPath, content, 'utf-8')
    generated.push('AGENTS.md (overwritten)')
  } else {
    const content = generateAgentsMd(profile)
    await writeFile(agentsMdPath, content, 'utf-8')
    generated.push('AGENTS.md')
  }

  // Print summary
  if (generated.length > 0) {
    console.log('Generated:')
    for (const f of generated) {
      console.log(`  - ${f}`)
    }
  }

  if (skipped.length > 0) {
    console.log('Skipped:')
    for (const f of skipped) {
      console.log(`  - ${f}`)
    }
  }

  if (generated.length === 0 && skipped.length > 0) {
    console.log('\nNothing to generate. Use --force to overwrite existing files.')
  }
}

// ---------------------------------------------------------------------------
// Provider config builder
// ---------------------------------------------------------------------------

type ApiKeys = {
  openai: boolean
  anthropic: boolean
  grok: boolean
  deepseek: boolean
}

/**
 * Build agents.yaml content from detected providers.
 * Priority: CLI tools first, then API keys.
 * Assigns the best available provider to architect, others to reviewers.
 */
function buildAgentsYaml(
  detected: { claudeCli: boolean; codexCli: boolean },
  apiKeys: ApiKeys,
): string {
  // Collect available providers in priority order
  const available: Array<{ provider: string; model: string }> = []

  if (detected.claudeCli) available.push({ provider: 'claude-cli', model: 'sonnet' })
  if (detected.codexCli) available.push({ provider: 'codex-cli', model: 'o4-mini' })
  if (apiKeys.openai) available.push({ provider: 'openai', model: 'gpt-4o' })
  if (apiKeys.anthropic)
    available.push({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })
  if (apiKeys.grok) available.push({ provider: 'grok', model: 'grok-3' })
  if (apiKeys.deepseek) available.push({ provider: 'deepseek', model: 'deepseek-chat' })

  if (available.length === 0) return '# No providers detected. Configure manually.\n'

  // Architect gets the first available provider
  const architect = available[0]

  // Reviewer gets the second available, or the same as architect if only one
  const reviewer = available.length > 1 ? available[1] : available[0]

  const lines: string[] = [
    '# Agent Orchestra — Provider Configuration',
    '# Auto-generated by: agent-orchestra init',
    '# Edit to customize per-agent providers.',
    '',
    'architect:',
    `  provider: ${architect.provider}`,
    `  model: ${architect.model}`,
    '',
    'reviewer:',
    `  provider: ${reviewer.provider}`,
    `  model: ${reviewer.model}`,
  ]

  // If more providers available, add them as commented reviewers
  if (available.length > 2) {
    lines.push('')
    lines.push('# Additional providers available (uncomment to use as extra reviewers):')
    lines.push('# reviewers:')
    for (let i = 0; i < available.length; i++) {
      const p = available[i]
      lines.push(`#   - provider: ${p.provider}`)
      lines.push(`#     model: ${p.model}`)
      if (i === 0) lines.push('#     lens: logic')
      else if (i === 1) lines.push('#     lens: security')
      else if (i === 2) lines.push('#     lens: scope')
      else lines.push('#     lens: risk')
    }
  }

  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize Agent Orchestra in the current project')
    .option('--path <path>', 'Project root path', process.cwd())
    .option('--yes', 'Skip confirmation prompts', false)
    .option(
      '--project-type <type>',
      'Override detected project type (node-ts, python, rust, generic)',
    )
    .option('--with-policy', 'Generate a starter policy.yaml', false)
    .option('--with-skillsets', 'Generate a starter skillsets.yaml', false)
    .option('--force', 'Overwrite existing generated files', false)
    .action(
      handleErrors(
        async (opts: {
          path: string
          yes: boolean
          projectType?: string
          withPolicy: boolean
          withSkillsets: boolean
          force: boolean
        }) => {
          await runInit(opts)
        },
      ),
    )
}
