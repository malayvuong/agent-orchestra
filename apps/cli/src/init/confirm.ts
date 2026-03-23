import { createInterface } from 'node:readline/promises'

type ConfirmRefreshAgentsOptions = {
  refreshAgents: boolean
  yes: boolean
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
}

export async function shouldRefreshAgentsConfig(
  options: ConfirmRefreshAgentsOptions,
): Promise<boolean> {
  if (options.refreshAgents) {
    return true
  }

  if (options.yes) {
    return false
  }

  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout

  if (!input.isTTY || !output.isTTY) {
    return false
  }

  const rl = createInterface({ input, output })
  try {
    const answer = (
      await rl.question(
        'Detected updated provider defaults for .agent-orchestra/agents.yaml. Replace the existing file? [y/N] ',
      )
    )
      .trim()
      .toLowerCase()

    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}
