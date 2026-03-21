import { Command } from 'commander'
import { registerSkillsCommand } from './commands/skills.js'
import { registerAuditCommand } from './commands/audit.js'
import { registerPolicyCommand } from './commands/policy.js'

export function createProgram(): Command {
  const program = new Command()
    .name('agent-orchestra')
    .description('AI agent orchestration for multi-agent code review and planning')
    .version('0.0.1')

  registerSkillsCommand(program)
  registerAuditCommand(program)
  registerPolicyCommand(program)

  return program
}
