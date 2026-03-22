import { execFile } from 'node:child_process'

/**
 * Check whether a CLI command is available on the system PATH.
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(whichCmd, [command], (error) => {
      resolve(!error)
    })
  })
}

/** Result of detecting available CLI providers */
export type DetectedProviders = {
  claudeCli: boolean
  codexCli: boolean
  preferred: 'claude-cli' | 'codex-cli' | null
}

/**
 * Detect which CLI-based LLM tools are available on the system.
 * Returns the preferred provider (claude-cli first, then codex-cli).
 */
export async function detectCliProviders(): Promise<DetectedProviders> {
  const [claudeCli, codexCli] = await Promise.all([
    isCommandAvailable('claude'),
    isCommandAvailable('codex'),
  ])

  let preferred: DetectedProviders['preferred'] = null
  if (claudeCli) preferred = 'claude-cli'
  else if (codexCli) preferred = 'codex-cli'

  return { claudeCli, codexCli, preferred }
}
