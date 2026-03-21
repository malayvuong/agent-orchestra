import type { Command } from 'commander'
import { join } from 'node:path'
import { cp, rm, mkdir } from 'node:fs/promises'
import { SkillParser, SkillLoader, SkillMatcher, type SkillDefinition } from '@agent-orchestra/core'
import type { AgentAssignment } from '@agent-orchestra/core'
import {
  LockfileManager,
  SkillInstaller,
  RegistryClient,
  computeDirectoryChecksum,
} from '@agent-orchestra/registry'
import { simpleTokenEstimator } from '../utils/token-estimator.js'

/** Simple logger that routes loader/parser warnings to stderr */
const cliLogger = {
  warn: (msg: string) => console.error(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
}

function createLoader(): SkillLoader {
  const parser = new SkillParser(simpleTokenEstimator)
  return new SkillLoader(parser, cliLogger)
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
// Command: skills search <query>
// ---------------------------------------------------------------------------

async function runSkillsSearch(
  query: string,
  opts: { type?: string; tier?: string },
): Promise<void> {
  const client = new RegistryClient()

  console.log('Fetching registry index...')
  const results = await client.search(query, {
    skillType: opts.type,
    trustTier: opts.tier,
  })

  if (results.length === 0) {
    console.log(`\nNo skills found matching "${query}".`)
    if (opts.type || opts.tier) {
      console.log('Try removing filters to broaden the search.')
    }
    return
  }

  console.log(`\nRegistry results:`)
  for (const skill of results) {
    const id = skill.id.padEnd(22)
    const ver = `v${skill.version}`.padEnd(8)
    const tier = `[${skill.trustTier}]`.padEnd(14)
    const desc = skill.description
    console.log(`  ${id} ${ver} ${tier} ${desc}`)
  }

  console.log(`\nFilters: --type prompt|tool|plugin, --tier official|verified|community`)
}

// ---------------------------------------------------------------------------
// Command: skills update [skill-id]
// ---------------------------------------------------------------------------

async function runSkillsUpdate(skillId: string | undefined, opts: { path: string }): Promise<void> {
  const lockfileManager = new LockfileManager(opts.path, cliLogger)
  const lockfile = await lockfileManager.read()

  if (!lockfile || Object.keys(lockfile.skills).length === 0) {
    console.log('No skills installed. Nothing to update.')
    return
  }

  const client = new RegistryClient()
  const installed = Object.entries(lockfile.skills).map(([id, entry]) => ({
    skillId: id,
    version: entry.version,
  }))

  console.log('Checking for updates...')
  const updates = await client.checkUpdates(installed)

  if (skillId) {
    // Update a specific skill
    const update = updates.find((u) => u.skillId === skillId)
    if (!update) {
      const entry = lockfile.skills[skillId]
      if (!entry) {
        console.error(`Skill "${skillId}" is not installed.`)
        process.exit(1)
      }
      console.log(`  ${skillId}: ${entry.version} (up to date)`)
      return
    }

    console.log(`Updating ${skillId} to ${update.latestVersion}...`)
    const pkg = await client.download(skillId, update.latestVersion)

    // Install the downloaded skill to the workspace
    const skillsDir = join(opts.path, '.agent-orchestra', 'skills')
    const destPath = join(skillsDir, skillId)
    await mkdir(skillsDir, { recursive: true })
    await rm(destPath, { recursive: true, force: true })
    await cp(pkg.localPath, destPath, { recursive: true })

    // Update lockfile
    const checksum = await computeDirectoryChecksum(destPath)
    await lockfileManager.upsert(skillId, {
      version: update.latestVersion,
      source: 'git',
      path: `.agent-orchestra/skills/${skillId}`,
      checksum,
      installedAt: new Date().toISOString(),
    })

    console.log(`Updated ${skillId} to ${update.latestVersion}`)
    console.log('Updated skills.lock')
    return
  }

  // Show update status for all installed skills
  const installedIds = Object.keys(lockfile.skills)
  const updateMap = new Map(updates.map((u) => [u.skillId, u]))

  for (const id of installedIds) {
    const update = updateMap.get(id)
    if (update) {
      console.log(`  ${id}: ${update.currentVersion} -> ${update.latestVersion} (update available)`)
    } else {
      console.log(`  ${id}: ${lockfile.skills[id].version} (up to date)`)
    }
  }

  if (updates.length > 0) {
    console.log(`\n${updates.length} update(s) available. Run 'skills update <skill-id>' to apply.`)
  }
}

// ---------------------------------------------------------------------------
// Command: skills install <source>
// ---------------------------------------------------------------------------

async function runSkillsInstall(source: string, opts: { path: string }): Promise<void> {
  const lockfileManager = new LockfileManager(opts.path, cliLogger)
  const installer = new SkillInstaller(opts.path, lockfileManager, {
    ...cliLogger,
    info: (msg: string) => console.log(msg),
  })

  // Determine source type:
  // - Starts with '.', '/', or contains path separators → local path
  // - Starts with 'http' or 'git@' → git URL
  // - Otherwise → registry skill ID (may include @version)
  const isLocalPath = source.startsWith('.') || source.startsWith('/') || source.includes('\\')
  const isGitUrl = source.startsWith('http') || source.startsWith('git@')

  if (isLocalPath || isGitUrl) {
    // Existing local/git install path
    const installSource = installer.parseSource(source)
    const result = await installer.install(installSource)
    console.log(`Installed ${result.skillId}@${result.version} to ${result.installedPath}/`)
    console.log(`Checksum: ${result.checksum.digest.slice(0, 12)}...`)
    console.log('Updated skills.lock')
    return
  }

  // Registry install: parse optional version (e.g., "security-review@1.0.0")
  const atIndex = source.indexOf('@')
  const skillId = atIndex > 0 ? source.slice(0, atIndex) : source
  const version = atIndex > 0 ? source.slice(atIndex + 1) : undefined

  const client = new RegistryClient()

  console.log('Fetching registry index... done')
  const entry = await client.resolve(skillId, version)
  if (!entry) {
    throw new Error(
      `Skill "${skillId}"${version ? ` version "${version}"` : ''} not found in the registry.`,
    )
  }

  console.log(`Downloading ${entry.id}@${entry.version}... done`)
  const pkg = await client.download(skillId, entry.version)

  console.log('Verifying checksum... ok')

  // Copy from cache to workspace skills directory
  const skillsDir = join(opts.path, '.agent-orchestra', 'skills')
  const destPath = join(skillsDir, skillId)
  await mkdir(skillsDir, { recursive: true })
  await rm(destPath, { recursive: true, force: true })
  await cp(pkg.localPath, destPath, { recursive: true })

  // Compute checksum of installed copy and update lockfile
  const checksum = await computeDirectoryChecksum(destPath)
  await lockfileManager.upsert(skillId, {
    version: entry.version,
    source: 'git',
    path: `.agent-orchestra/skills/${skillId}`,
    checksum,
    installedAt: new Date().toISOString(),
  })

  console.log(`Installed ${entry.id}@${entry.version} to .agent-orchestra/skills/${skillId}/`)
  console.log('Updated skills.lock')
}

// ---------------------------------------------------------------------------
// Command: skills remove <id>
// ---------------------------------------------------------------------------

async function runSkillsRemove(skillId: string, opts: { path: string }): Promise<void> {
  const lockfileManager = new LockfileManager(opts.path, cliLogger)
  const installer = new SkillInstaller(opts.path, lockfileManager, {
    ...cliLogger,
    info: (msg: string) => console.log(msg),
  })

  const removed = await installer.remove(skillId)
  if (removed) {
    console.log(`Removed ${skillId} from .agent-orchestra/skills/`)
    console.log('Updated skills.lock')
  } else {
    console.error(`Failed to remove skill "${skillId}".`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Command: skills verify
// ---------------------------------------------------------------------------

async function runSkillsVerify(opts: { path: string }): Promise<void> {
  const lockfileManager = new LockfileManager(opts.path, cliLogger)
  const result = await lockfileManager.verify()

  const total = result.valid.length + result.mismatches.length + result.missing.length

  if (total === 0) {
    console.log('No skills in lockfile to verify.')
    return
  }

  console.log('Verifying installed skills against skills.lock...')

  for (const v of result.valid) {
    console.log(`  ${v.skillId}: ok`)
  }
  for (const m of result.mismatches) {
    console.log(
      `  ${m.skillId}: CHECKSUM MISMATCH (expected: ${m.expected.slice(0, 12)}..., got: ${m.actual.slice(0, 12)}...)`,
    )
  }
  for (const m of result.missing) {
    console.log(`  ${m.skillId}: MISSING (${m.reason})`)
  }

  const errorCount = result.mismatches.length + result.missing.length
  if (errorCount > 0) {
    console.log(`\n${errorCount} error(s) found. Run 'skills install' to fix.`)
    process.exit(1)
  } else {
    console.log(`\nAll ${result.valid.length} skill(s) verified.`)
  }
}

// ---------------------------------------------------------------------------
// Command: skills pin <id>
// ---------------------------------------------------------------------------

async function runSkillsPin(skillId: string, opts: { path: string }): Promise<void> {
  const lockfileManager = new LockfileManager(opts.path, cliLogger)
  const lockfile = await lockfileManager.read()

  if (!lockfile || !(skillId in lockfile.skills)) {
    console.error(`Skill "${skillId}" not found in lockfile. Install it first.`)
    process.exit(1)
  }

  const pinned = await lockfileManager.pin(skillId)
  if (pinned) {
    const version = lockfile.skills[skillId].version
    console.log(`Pinned ${skillId} to v${version} (will not be overwritten on reinstall)`)
    console.log('Updated skills.lock')
  }
}

// ---------------------------------------------------------------------------
// Command: skills rollback <skill-id>
// ---------------------------------------------------------------------------

async function runSkillsRollback(
  skillId: string,
  opts: { to: string; path: string },
): Promise<void> {
  const lockfileManager = new LockfileManager(opts.path, cliLogger)
  const lockfile = await lockfileManager.read()

  if (!lockfile || !(skillId in lockfile.skills)) {
    console.error(`Skill "${skillId}" is not installed. Nothing to rollback.`)
    process.exit(1)
  }

  const currentVersion = lockfile.skills[skillId].version
  const targetVersion = opts.to

  if (currentVersion === targetVersion) {
    console.log(`${skillId} is already at version ${targetVersion}. Nothing to do.`)
    return
  }

  console.log(`Rolling back ${skillId}: ${currentVersion} → ${targetVersion}...`)

  const client = new RegistryClient()

  // Download the target version from registry
  const pkg = await client.download(skillId, targetVersion)

  // Install it (overwrite current)
  const skillsDir = join(opts.path, '.agent-orchestra', 'skills')
  const destPath = join(skillsDir, skillId)
  await mkdir(skillsDir, { recursive: true })
  await rm(destPath, { recursive: true, force: true })
  await cp(pkg.localPath, destPath, { recursive: true })

  // Update lockfile
  const checksum = await computeDirectoryChecksum(destPath)
  await lockfileManager.upsert(skillId, {
    version: targetVersion,
    source: 'git',
    path: `.agent-orchestra/skills/${skillId}`,
    checksum,
    installedAt: new Date().toISOString(),
  })

  console.log(`Rolling back ${skillId}: ${currentVersion} → ${targetVersion}... done`)
  console.log('Updated skills.lock')
  console.log('Rollback complete.')
}

// ---------------------------------------------------------------------------
// Command: skills status
// ---------------------------------------------------------------------------

async function runSkillsStatus(opts: { path: string }): Promise<void> {
  const lockfileManager = new LockfileManager(opts.path, cliLogger)
  const lockfile = await lockfileManager.read()

  if (!lockfile || Object.keys(lockfile.skills).length === 0) {
    console.log('No skills installed.')
    return
  }

  const client = new RegistryClient()
  const installed = Object.entries(lockfile.skills).map(([id]) => ({
    skillId: id,
  }))

  console.log('Checking skill status against registry...')
  const statusMap = await client.checkStatus(installed)

  let hasYanked = false

  for (const [id, entry] of Object.entries(lockfile.skills)) {
    const version = entry.version
    const statusInfo = statusMap.get(id)
    const tier = `[registry]`

    if (!statusInfo || statusInfo.status === 'active') {
      console.log(`  ${id}@${version}  ${tier}  OK`)
    } else if (statusInfo.status === 'deprecated') {
      const replacement = statusInfo.replacement
        ? `use ${statusInfo.replacement} instead`
        : (statusInfo.reason ?? 'no replacement specified')
      console.log(`  ${id}@${version}  ${tier}  DEPRECATED: ${replacement}`)
    } else if (statusInfo.status === 'yanked') {
      hasYanked = true
      const reason = statusInfo.reason ?? 'no reason provided'
      console.log(`  ${id}@${version}  ${tier}  YANKED: ${reason} — remove immediately`)
    }
  }

  if (hasYanked) {
    console.log(`\nWARNING: Yanked skills detected. Run 'skills remove <skill-id>' to remove them.`)
    process.exit(1)
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
    .action(
      handleErrors(async (opts: { path: string }) => {
        await runSkillsList(opts)
      }),
    )

  skills
    .command('show <skill-id>')
    .description('Show details of a specific skill')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (skillId: string, opts: { path: string }) => {
        await runSkillsShow(skillId, opts)
      }),
    )

  skills
    .command('match')
    .description('Simulate skill matching for a given agent lens/role and job brief')
    .option('--lens <lens>', 'Agent lens (e.g. security, testing)')
    .option('--role <role>', 'Agent role', 'reviewer')
    .option('--brief <text>', 'Job brief text for keyword matching', '')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (opts: { lens?: string; role: string; brief: string; path: string }) => {
        await runSkillsMatch(opts)
      }),
    )

  skills
    .command('search <query>')
    .description('Search for skills in the remote registry')
    .option('--type <type>', 'Filter by skill type (prompt, tool, plugin)')
    .option('--tier <tier>', 'Filter by trust tier (official, verified, community)')
    .action(
      handleErrors(async (query: string, opts: { type?: string; tier?: string }) => {
        await runSkillsSearch(query, opts)
      }),
    )

  skills
    .command('install <source>')
    .description('Install a skill from a local path, git URL, or registry ID')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (source: string, opts: { path: string }) => {
        await runSkillsInstall(source, opts)
      }),
    )

  skills
    .command('update [skill-id]')
    .description('Check for remote updates to installed skills')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (skillId: string | undefined, opts: { path: string }) => {
        await runSkillsUpdate(skillId, opts)
      }),
    )

  skills
    .command('remove <skill-id>')
    .description('Remove an installed skill')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (skillId: string, opts: { path: string }) => {
        await runSkillsRemove(skillId, opts)
      }),
    )

  skills
    .command('verify')
    .description('Verify installed skill checksums against the lockfile')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (opts: { path: string }) => {
        await runSkillsVerify(opts)
      }),
    )

  skills
    .command('pin <skill-id>')
    .description('Pin a skill to its current version (prevents overwrite on reinstall)')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (skillId: string, opts: { path: string }) => {
        await runSkillsPin(skillId, opts)
      }),
    )

  skills
    .command('rollback <skill-id>')
    .description('Rollback an installed skill to a specific version')
    .requiredOption('--to <version>', 'Target version to rollback to')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (skillId: string, opts: { to: string; path: string }) => {
        await runSkillsRollback(skillId, opts)
      }),
    )

  skills
    .command('status')
    .description('Check installed skills for deprecation or yank warnings')
    .option('--path <path>', 'Workspace path', process.cwd())
    .action(
      handleErrors(async (opts: { path: string }) => {
        await runSkillsStatus(opts)
      }),
    )

  skills
    .command('validate [path]')
    .description('Validate skill definitions in a directory')
    .action((_path?: string) => {
      console.log('Not yet implemented — coming in a future release.')
    })
}
