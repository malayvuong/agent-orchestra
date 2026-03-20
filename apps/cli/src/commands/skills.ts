import type { Command } from 'commander'
import { SkillParser, SkillLoader, SkillMatcher, type SkillDefinition } from '@agent-orchestra/core'
import type { AgentAssignment } from '@agent-orchestra/core'
import { simpleTokenEstimator } from '../utils/token-estimator.js'

function createLoader(): SkillLoader {
  const parser = new SkillParser(simpleTokenEstimator)
  return new SkillLoader(parser)
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format the source path of a skill as a relative display path.
 * The source path is the SKILL.md file; strip the filename to show directory.
 */
function formatSourceDir(skill: SkillDefinition): string {
  const src = skill.source
  if (src.type === 'local') {
    // path is <dir>/SKILL.md — return the parent directory with trailing slash
    const dir = src.path.replace(/\/SKILL\.md$/, '')
    return dir + '/'
  }
  return src.type === 'registry' ? `registry:${src.name}` : `git:${src.repoUrl}`
}

function formatTriggerTag(skill: SkillDefinition): string {
  const t = skill.triggers
  if (!t) return '[always-on]'
  const parts: string[] = []
  if (t.lenses && t.lenses.length > 0) parts.push(`lens:${t.lenses.join(',')}`)
  if (t.roles && t.roles.length > 0) parts.push(`role:${t.roles.join(',')}`)
  if (t.keywords && t.keywords.length > 0) parts.push(`kw:${t.keywords.join(',')}`)
  if (t.lifecycle && t.lifecycle.length > 0) parts.push(`lifecycle:${t.lifecycle.join(',')}`)
  return parts.length > 0 ? `[${parts.join(' ')}]` : '[always-on]'
}

// ---------------------------------------------------------------------------
// Command: skills list
// ---------------------------------------------------------------------------

async function runSkillsList(opts: { path: string }): Promise<void> {
  const loader = createLoader()
  const result = await loader.loadFromWorkspace(opts.path)

  const { skills, errors } = result

  if (skills.length === 0 && errors.length === 0) {
    console.log('No skills found.')
    return
  }

  if (skills.length > 0) {
    console.log(`\nLoaded skills (${skills.length} found):`)
    for (const skill of skills) {
      const id = skill.id.padEnd(20)
      const ver = `v${skill.version}`.padEnd(8)
      const tag = formatTriggerTag(skill).padEnd(22)
      const src = formatSourceDir(skill)
      console.log(`  ${id} ${ver} ${tag} ${src}`)
    }
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`)
    for (const err of errors) {
      console.log(`  ${err.path}: ${err.error}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Command: skills show <id>
// ---------------------------------------------------------------------------

async function runSkillsShow(skillId: string, opts: { path: string }): Promise<void> {
  const loader = createLoader()
  const result = await loader.loadFromWorkspace(opts.path)

  const skill = result.skills.find((s) => s.id === skillId)

  if (!skill) {
    // Try to give a helpful message listing available skills
    const available = result.skills.map((s) => s.id)
    if (available.length > 0) {
      console.error(`Skill "${skillId}" not found. Available skills: ${available.join(', ')}`)
    } else {
      console.error(`Skill "${skillId}" not found. No skills loaded from workspace.`)
    }
    process.exit(1)
  }

  const contentTokens = simpleTokenEstimator.estimate(skill.promptContent)
  const summaryTokens = simpleTokenEstimator.estimate(skill.promptSummary)

  const t = skill.triggers
  const lenses = t?.lenses?.length ? `lenses=[${t.lenses.join(', ')}]` : ''
  const keywords = t?.keywords?.length ? `keywords=[${t.keywords.join(', ')}]` : ''
  const triggersStr = [lenses, keywords].filter(Boolean).join(', ')

  console.log(`\n${skill.id} v${skill.version}`)
  if (skill.license) {
    console.log(`License: ${skill.license}`)
  }
  if (triggersStr) {
    console.log(`Triggers: ${triggersStr}`)
  } else {
    console.log('Triggers: always-on')
  }
  console.log(`Source: ${formatSourceDir(skill)}`)
  console.log(`Content: ${contentTokens} tokens (summary: ${summaryTokens} tokens)`)
  console.log('\n--- Summary ---')
  console.log(skill.promptSummary || '(no summary)')
}

// ---------------------------------------------------------------------------
// Command: skills match
// ---------------------------------------------------------------------------

async function runSkillsMatch(opts: {
  lens?: string
  role: string
  brief: string
  path: string
}): Promise<void> {
  const loader = createLoader()
  const result = await loader.loadFromWorkspace(opts.path)
  const { skills } = result

  if (skills.length === 0) {
    console.log('No skills loaded — nothing to match.')
    return
  }

  // Build a minimal AgentAssignment for matching
  const agent: AgentAssignment = {
    id: 'cli-match',
    agentConfigId: 'cli-match',
    role: opts.role as AgentAssignment['role'],
    lens: opts.lens as AgentAssignment['lens'] | undefined,
    connectionType: 'cli',
    providerKey: 'cli',
    modelOrCommand: 'cli',
    protocol: 'cli',
    enabled: true,
    allowReferenceScan: false,
    canWriteCode: false,
  }

  const matcher = new SkillMatcher()
  const matchResult = matcher.match(skills, agent, { jobBrief: opts.brief })

  const matchedIds = new Set(matchResult.matched.map((s) => s.id))
  const unmatched = skills.filter((s) => !matchedIds.has(s.id))

  if (matchResult.matched.length > 0) {
    console.log(`\nMatched skills (${matchResult.matched.length}):`)
    for (const skill of matchResult.matched) {
      const reason = matchResult.reason.get(skill.id) ?? 'unknown'
      console.log(`  ${skill.id}  <- ${reason}`)
    }
  } else {
    console.log('\nMatched skills (0):')
    console.log('  (none)')
  }

  if (unmatched.length > 0) {
    console.log(`\nUnmatched skills (${unmatched.length}):`)
    for (const skill of unmatched) {
      const t = skill.triggers
      const parts: string[] = []
      if (t?.lenses?.length) parts.push(`lens=${t.lenses.join(',')}`)
      if (t?.roles?.length) parts.push(`role=${t.roles.join(',')}`)
      if (t?.keywords?.length) parts.push(`keywords=${t.keywords.join(',')}`)
      if (t?.lifecycle?.length) parts.push(`lifecycle=${t.lifecycle.join(',')}`)
      const triggerDesc = parts.length > 0 ? parts.join(', ') : 'always-on'
      console.log(`  ${skill.id} (triggers: ${triggerDesc} — does not match)`)
    }
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSkillsCommand(program: Command): void {
  const skills = program.command('skills').description('Manage prompt skills')

  skills
    .command('list')
    .description('List loaded skills')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(async (opts: { path: string }) => {
      await runSkillsList(opts)
    })

  skills
    .command('show <skill-id>')
    .description('Show details of a specific skill')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(async (skillId: string, opts: { path: string }) => {
      await runSkillsShow(skillId, opts)
    })

  skills
    .command('match')
    .description('Simulate skill matching for a given agent lens/role and job brief')
    .option('--lens <lens>', 'Agent lens (e.g. security, testing)')
    .option('--role <role>', 'Agent role', 'reviewer')
    .option('--brief <text>', 'Job brief text for keyword matching', '')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(async (opts: { lens?: string; role: string; brief: string; path: string }) => {
      await runSkillsMatch(opts)
    })

  skills
    .command('validate [path]')
    .description('Validate skill definitions in a directory')
    .action((path?: string) => {
      console.log(`Validate skills at ${path ?? '.'} — not yet implemented (Phase A)`)
    })
}
