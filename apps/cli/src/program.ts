import { Command } from 'commander'
import { registerSkillsCommand } from './commands/skills.js'
import { registerAuditCommand } from './commands/audit.js'
import { registerPolicyCommand } from './commands/policy.js'
import { registerRunCommand } from './commands/run.js'
import { registerJobCommand } from './commands/job.js'
import { registerSuperpowersCommand } from './commands/superpowers.js'
import { registerInitCommand } from './commands/init.js'
import { registerServeCommand } from './commands/serve.js'

export function createProgram(): Command {
  const program = new Command()
    .name('agent-orchestra')
    .description('AI agent orchestration for multi-agent code review and planning')
    .version('0.0.1')

  // Show help when no command is given (instead of erroring)
  program.action(() => {
    program.outputHelp()
  })

  registerSkillsCommand(program)
  registerAuditCommand(program)
  registerPolicyCommand(program)
  registerRunCommand(program)
  registerJobCommand(program)
  registerSuperpowersCommand(program)
  registerInitCommand(program)
  registerServeCommand(program)

  return program
}
