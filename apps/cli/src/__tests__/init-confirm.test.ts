import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { shouldRefreshAgentsConfig } from '../init/confirm.js'

function makeTTYInput(answer?: string): NodeJS.ReadStream {
  const input = new PassThrough() as PassThrough & NodeJS.ReadStream
  input.isTTY = true
  if (answer !== undefined) {
    input.end(answer)
  }
  return input
}

function makeTTYOutput(): NodeJS.WriteStream {
  const output = new PassThrough() as PassThrough & NodeJS.WriteStream
  output.isTTY = true
  return output
}

describe('shouldRefreshAgentsConfig', () => {
  it('returns true when --refresh-agents is set', async () => {
    const result = await shouldRefreshAgentsConfig({
      refreshAgents: true,
      yes: false,
    })

    expect(result).toBe(true)
  })

  it('returns false when --yes is set without --refresh-agents', async () => {
    const result = await shouldRefreshAgentsConfig({
      refreshAgents: false,
      yes: true,
    })

    expect(result).toBe(false)
  })

  it('returns false when stdin/stdout are not interactive', async () => {
    const input = new PassThrough() as PassThrough & NodeJS.ReadStream
    const output = new PassThrough() as PassThrough & NodeJS.WriteStream
    input.isTTY = false
    output.isTTY = false

    const result = await shouldRefreshAgentsConfig({
      refreshAgents: false,
      yes: false,
      input,
      output,
    })

    expect(result).toBe(false)
  })

  it('returns true when the interactive user answers yes', async () => {
    const result = await shouldRefreshAgentsConfig({
      refreshAgents: false,
      yes: false,
      input: makeTTYInput('y\n'),
      output: makeTTYOutput(),
    })

    expect(result).toBe(true)
  })

  it('returns false when the interactive user answers no', async () => {
    const result = await shouldRefreshAgentsConfig({
      refreshAgents: false,
      yes: false,
      input: makeTTYInput('n\n'),
      output: makeTTYOutput(),
    })

    expect(result).toBe(false)
  })
})
