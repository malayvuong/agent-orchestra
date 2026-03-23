import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveRunSkills } from '../superpowers/resolve-run-skills.js'

let workspacePath: string

async function writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
  const absolutePath = join(workspacePath, relativePath)
  await mkdir(join(absolutePath, '..'), { recursive: true })
  await writeFile(absolutePath, content, 'utf-8')
}

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'ao-run-skills-'))
  workspacePath = await realpath(workspacePath)
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('resolveRunSkills', () => {
  it('materializes concrete skills from direct skill IDs and skillset IDs', async () => {
    await writeWorkspaceFile(
      '.agent-orchestra/skills/risk-check/SKILL.md',
      `---
name: Risk Check
description: Review plan risk
version: 2026.3.1
triggers:
  roles: [architect]
---

Assess risk.
`,
    )
    await writeWorkspaceFile(
      '.agent-orchestra/skills/scope-discipline/SKILL.md',
      `---
name: Scope Discipline
description: Keep scope tight
version: 2026.3.1
triggers:
  roles: [reviewer]
---

Check scope.
`,
    )
    await writeWorkspaceFile(
      '.agent-orchestra/skillsets.yaml',
      `skillsets:
  - id: plan-skillset
    name: Plan Skillset
    description: Plan review helpers
    skills:
      - scope-discipline
`,
    )

    const resolvedSkills = await resolveRunSkills({
      workspacePath,
      resolvedSkillIds: ['risk-check'],
      resolvedSkillSetIds: ['plan-skillset'],
    })

    expect(resolvedSkills.map((skill) => skill.id).sort()).toEqual([
      'risk-check',
      'scope-discipline',
    ])
  })
})
