#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  globalThis.console.log(
    'Usage: node scripts/publish-if-missing.mjs <package-dir> <registry-url> [access]',
  )
  process.exit(0)
}

const [packageDir, registryUrl, access] = args

if (!packageDir || !registryUrl) {
  globalThis.console.error(
    'Usage: node scripts/publish-if-missing.mjs <package-dir> <registry-url> [access]',
  )
  process.exit(1)
}

const packageJsonPath = resolve(packageDir, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
const packageSpec = `${packageJson.name}@${packageJson.version}`

const npmView = spawnSync('npm', ['view', packageSpec, 'version', '--registry', registryUrl], {
  encoding: 'utf-8',
  stdio: 'pipe',
  env: process.env,
})

if (npmView.status === 0) {
  globalThis.console.log(`${packageSpec} already exists on ${registryUrl}, skipping publish.`)
  process.exit(0)
}

const publishArgs = ['--dir', packageDir, 'publish', '--no-git-checks', '--registry', registryUrl]
if (access) {
  publishArgs.push('--access', access)
}

globalThis.console.log(`Publishing ${packageSpec} to ${registryUrl}...`)

const publish = spawnSync('pnpm', publishArgs, {
  stdio: 'inherit',
  env: process.env,
})

process.exit(publish.status ?? 1)
