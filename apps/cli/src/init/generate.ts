import type { ProjectProfile } from './detect.js'

/**
 * Generate AGENTS.md content tailored to the detected project profile.
 */
export function generateAgentsMd(profile: ProjectProfile): string {
  const superpowerCommands = profile.recommendedSuperpowers
    .map((sp) => `- \`agent-orchestra run --target <file-or-dir> --superpower ${sp}\``)
    .join('\n')

  const useCases = buildUseCases(profile)
  const notes = buildNotes(profile)

  return `# Agent Instructions

This repository uses [Agent Orchestra](https://github.com/nicemvp/agent-orchestra) for structured multi-agent review.

## When to use Agent Orchestra

${useCases}

## Recommended commands

${superpowerCommands}

## Available superpowers

| Superpower | Purpose |
|---|---|
| \`security-review\` | OWASP-based security audit for code |
| \`test-generation\` | Test coverage analysis and test case recommendations |
| \`auto-fix-lint\` | Automated lint and code quality fixes (requires approval) |
| \`plan-review\` | Review implementation plans for sequencing, scope, and readiness |
| \`dependency-audit\` | Dependency vulnerability and license analysis (requires approval) |

## Notes

${notes}
`
}

/**
 * Build use-case recommendations based on project profile.
 */
function buildUseCases(profile: ProjectProfile): string {
  const lines: string[] = []

  if (profile.recommendedSuperpowers.includes('security-review')) {
    lines.push('- For security-sensitive code changes: use `security-review`')
  }

  if (profile.recommendedSuperpowers.includes('test-generation')) {
    lines.push('- For testing gaps or new modules: use `test-generation`')
  }

  if (profile.recommendedSuperpowers.includes('auto-fix-lint')) {
    lines.push('- For lint and code quality fixes: use `auto-fix-lint`')
  }

  if (profile.recommendedSuperpowers.includes('plan-review')) {
    lines.push('- For implementation plans, RFCs, or roadmaps: use `plan-review`')
  }

  if (lines.length === 0) {
    lines.push(
      '- Use Agent Orchestra when a task needs structured review, multi-agent debate, or auditability',
    )
  }

  return lines.join('\n')
}

/**
 * Build notes section based on project profile.
 */
function buildNotes(profile: ProjectProfile): string {
  const lines: string[] = [
    '- Prefer Agent Orchestra when the task needs structured review, debate, or auditability.',
    '- Keep normal edits lightweight — only invoke Agent Orchestra when a review is requested.',
  ]

  if (
    profile.recommendedSuperpowers.includes('auto-fix-lint') ||
    profile.recommendedSuperpowers.includes('dependency-audit')
  ) {
    lines.push(
      '- Some superpowers (`auto-fix-lint`, `dependency-audit`) require user approval before executing write or network operations.',
    )
  }

  if (profile.kind === 'generic') {
    lines.push(
      '- This project was detected as a generic/docs repository. `plan-review` is the primary recommended superpower.',
    )
  }

  return lines.join('\n')
}

/**
 * Generate a starter policy.yaml content.
 */
export function generatePolicyYaml(profile: ProjectProfile): string {
  const srcGlob =
    profile.kind === 'python'
      ? '"./**/*.py"'
      : profile.kind === 'rust'
        ? '"./src/**"'
        : '"./src/**"'

  const testGlob =
    profile.kind === 'python'
      ? '"./tests/**"'
      : profile.kind === 'rust'
        ? '"./tests/**"'
        : '"./tests/**"'

  return `# Agent Orchestra — Skill Policy Configuration
# Capabilities are denied by default. Add rules to grant access.

defaultAction: deny
maxExecutionMs: 30000
networkAllowed: false

rules:
  # Allow read access to source and test files
  - capability: fs.read
    action: allow
    scope:
      - ${srcGlob}
      - ${testGlob}

  # Require approval for write access
  - capability: fs.write
    action: require_approval
    scope:
      - ${srcGlob}

  # Uncomment to allow specific commands:
  # - capability: proc.spawn
  #   action: allow
  #   scope:
  #     - "npm test"
  #     - "npm run lint"
`
}

/**
 * Generate a starter skillsets.yaml content.
 */
export function generateSkillsetsYaml(_profile: ProjectProfile): string {
  const lines = [
    '# Agent Orchestra — Skill Set Configuration',
    '# Group skills into named sets with a shared context budget.',
    '',
    'skillsets: []',
    '',
    '# Example:',
    '# skillsets:',
    '#   - id: my-review',
    '#     name: My Review',
    '#     description: Custom review skill set',
    '#     skills:',
    '#       - security-review',
    '#       - code-quality',
    '#     contextBudgetPercent: 25',
  ]

  return lines.join('\n') + '\n'
}

/**
 * Generate the Agent Orchestra section to append to an existing AGENTS.md.
 */
export function generateAgentsSection(profile: ProjectProfile): string {
  const superpowerCommands = profile.recommendedSuperpowers
    .map((sp) => `- \`agent-orchestra run --target <file-or-dir> --superpower ${sp}\``)
    .join('\n')

  return `
## Agent Orchestra

This repository uses [Agent Orchestra](https://github.com/nicemvp/agent-orchestra) for structured multi-agent review.

### Recommended commands

${superpowerCommands}

### Notes

- Prefer Agent Orchestra when the task needs structured review, debate, or auditability.
- Keep normal edits lightweight — only invoke Agent Orchestra when a review is requested.
`
}
