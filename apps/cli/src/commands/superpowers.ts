import type { Command } from 'commander'
import { loadSuperpowerCatalog } from '@agent-orchestra/core'
import type { Superpower } from '@agent-orchestra/core'

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
 * Pad a string to the given width for column alignment.
 */
function pad(value: string, width: number): string {
  return value.padEnd(width)
}

/**
 * Format capabilities list for display.
 */
function formatCapabilities(superpower: Superpower): string {
  if (!superpower.capabilityExpectation || superpower.capabilityExpectation.length === 0) {
    return '(none required)'
  }
  return superpower.capabilityExpectation.join(', ')
}

// ---------------------------------------------------------------------------
// Command: superpowers list
// ---------------------------------------------------------------------------

async function runSuperpowersList(): Promise<void> {
  const catalog = loadSuperpowerCatalog()
  const superpowers = catalog.list()

  if (superpowers.length === 0) {
    console.log('No superpowers available.')
    return
  }

  console.log(`\nAvailable Superpowers (${superpowers.length}):`)

  // Calculate column widths
  const idWidth = Math.max(...superpowers.map((s) => s.id.length), 2) + 2
  const catWidth = Math.max(...superpowers.map((s) => s.category.length), 8) + 2
  const matWidth = Math.max(...superpowers.map((s) => s.maturity.length), 8) + 2

  for (const sp of superpowers) {
    const id = pad(sp.id, idWidth)
    const cat = pad(sp.category, catWidth)
    const mat = pad(sp.maturity, matWidth)
    console.log(`  ${id}${cat}${mat}${sp.description}`)
  }
}

// ---------------------------------------------------------------------------
// Command: superpowers show <id>
// ---------------------------------------------------------------------------

async function runSuperpowersShow(id: string): Promise<void> {
  const catalog = loadSuperpowerCatalog()

  if (!catalog.has(id)) {
    const available = catalog.list().map((s) => s.id)
    if (available.length > 0) {
      console.error(`Superpower "${id}" not found. Available: ${available.join(', ')}`)
    } else {
      console.error(`Superpower "${id}" not found. No superpowers available.`)
    }
    process.exit(1)
  }

  const sp = catalog.get(id)!

  console.log(`\n${sp.name} (${sp.id})`)
  console.log(`  Category: ${sp.category}`)
  console.log(`  Maturity: ${sp.maturity}`)
  console.log(`  Description: ${sp.description}`)
  console.log('')

  // Skills
  const skillIds = sp.skillIds ?? []
  const skillSetIds = sp.skillSetIds ?? []
  const allSkills = [...skillIds, ...skillSetIds]
  console.log(`  Skills: ${allSkills.length > 0 ? allSkills.join(', ') : '(none)'}`)

  // Protocol
  console.log(`  Protocol: ${sp.protocol ?? 'single_challenger'}`)

  // Agent preset
  if (sp.agentPreset.architect?.enabled) {
    console.log(
      `  Architect: enabled (${sp.agentPreset.architect.provider ?? 'openai'} / ${sp.agentPreset.architect.model ?? 'gpt-4o'})`,
    )
  }
  const reviewerLens = sp.agentPreset.reviewer.lens ?? '(default)'
  const reviewerCount = sp.agentPreset.reviewer.count ?? 1
  console.log(`  Reviewer: role=reviewer, lens=${reviewerLens}, count=${reviewerCount}`)

  // Capabilities
  console.log(`  Capabilities: ${formatCapabilities(sp)}`)

  // Approval
  console.log(`  Approval required: ${sp.requiresApproval ? 'yes' : 'no'}`)
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSuperpowersCommand(program: Command): void {
  const superpowers = program.command('superpowers').description('Manage superpower presets')

  superpowers
    .command('list')
    .description('List all available superpowers')
    .action(
      handleErrors(async () => {
        await runSuperpowersList()
      }),
    )

  superpowers
    .command('show <id>')
    .description('Show details of a specific superpower')
    .action(
      handleErrors(async (id: string) => {
        await runSuperpowersShow(id)
      }),
    )
}
