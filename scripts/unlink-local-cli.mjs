import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const prefix = execFileSync('npm', ['prefix', '-g'], {
  encoding: 'utf8',
}).trim()

const globalBinDir = globalThis.process.platform === 'win32' ? prefix : join(prefix, 'bin')

for (const command of ['ao', 'agent-orchestra']) {
  await rm(join(globalBinDir, command), { force: true })
}

globalThis.console.log(`Removed local Agent Orchestra links from ${globalBinDir}`)
