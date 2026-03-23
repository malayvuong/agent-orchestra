import { mkdir, rm, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cliEntry = join(repoRoot, 'apps/cli/dist/index.js')

const prefix = execFileSync('npm', ['prefix', '-g'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

const globalBinDir = globalThis.process.platform === 'win32' ? prefix : join(prefix, 'bin')

const commands = ['ao', 'agent-orchestra']

await mkdir(globalBinDir, { recursive: true })

for (const command of commands) {
  const linkPath = join(globalBinDir, command)
  if (existsSync(linkPath)) {
    await rm(linkPath, { force: true })
  }
  await symlink(cliEntry, linkPath)
}

globalThis.console.log(`Linked ${commands.join(', ')} -> ${cliEntry}`)
globalThis.console.log(`Global bin: ${globalBinDir}`)
