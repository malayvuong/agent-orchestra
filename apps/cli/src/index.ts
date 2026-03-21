import { createProgram } from './program.js'

const program = createProgram()

// Strip standalone '--' from argv so `pnpm dev:cli -- --help` works.
// pnpm forwards '--' literally when nesting filtered scripts.
const argv = process.argv.filter((arg, i) => !(arg === '--' && i >= 2))

program.parseAsync(argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`Error: ${message}`)
  process.exit(1)
})
