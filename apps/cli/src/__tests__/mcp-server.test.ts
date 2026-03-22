import { describe, it, expect } from 'vitest'
import { createProgram } from '../program.js'
import { createMcpServer } from '../mcp/server.js'
import { TOOL_DEFINITIONS } from '../mcp/tools.js'

function getRequiredFields(toolName: string): string[] {
  const tool = TOOL_DEFINITIONS.find((entry) => entry.name === toolName)!
  const schema = tool.inputSchema as { required?: string[] }
  return schema.required ?? []
}

function getToolProperties(toolName: string): Record<string, unknown> {
  const tool = TOOL_DEFINITIONS.find((entry) => entry.name === toolName)!
  const schema = tool.inputSchema as { properties?: Record<string, unknown> }
  return schema.properties ?? {}
}

// ---------------------------------------------------------------------------
// CLI serve command registration
// ---------------------------------------------------------------------------

describe('serve command — registration', () => {
  it('program has serve command registered', () => {
    const program = createProgram()
    const serve = program.commands.find((c) => c.name() === 'serve')
    expect(serve).toBeDefined()
  })

  it('serve command has --mcp option', () => {
    const program = createProgram()
    const serve = program.commands.find((c) => c.name() === 'serve')!
    const optionLongs = serve.options.map((o) => o.long)
    expect(optionLongs).toContain('--mcp')
  })

  it('serve command has --transport option', () => {
    const program = createProgram()
    const serve = program.commands.find((c) => c.name() === 'serve')!
    const optionLongs = serve.options.map((o) => o.long)
    expect(optionLongs).toContain('--transport')
  })

  it('serve command has --path option', () => {
    const program = createProgram()
    const serve = program.commands.find((c) => c.name() === 'serve')!
    const optionLongs = serve.options.map((o) => o.long)
    expect(optionLongs).toContain('--path')
  })
})

// ---------------------------------------------------------------------------
// MCP server creation
// ---------------------------------------------------------------------------

describe('createMcpServer', () => {
  it('creates a server instance', () => {
    const server = createMcpServer('/tmp/test-workspace')
    expect(server).toBeDefined()
  })

  it('server has correct tool count registered', async () => {
    // The server registers tools via setRequestHandler — we verify
    // the TOOL_DEFINITIONS array that feeds into it
    expect(TOOL_DEFINITIONS).toHaveLength(8)
  })
})

// ---------------------------------------------------------------------------
// Tool definition completeness
// ---------------------------------------------------------------------------

describe('MCP tool surface', () => {
  const expectedTools = [
    'list_superpowers',
    'review_target',
    'review_plan',
    'show_findings',
    'list_skills',
    'evaluate_policy',
    'get_job',
    'compare_runs',
  ]

  it('exposes exactly the specified tool surface', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort()
    expect(names).toEqual(expectedTools.sort())
  })

  it('does NOT expose sandbox execution tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    expect(names).not.toContain('execute_sandbox')
    expect(names).not.toContain('run_sandbox')
  })

  it('does NOT expose direct provider call tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    expect(names).not.toContain('call_provider')
    expect(names).not.toContain('invoke_llm')
  })

  it('does NOT expose plugin installation tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    expect(names).not.toContain('install_skill')
    expect(names).not.toContain('remove_skill')
    expect(names).not.toContain('update_skill')
  })

  it('does NOT expose storage mutation tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    expect(names).not.toContain('delete_job')
    expect(names).not.toContain('update_job')
    expect(names).not.toContain('create_job')
  })
})

// ---------------------------------------------------------------------------
// review_target schema validates required fields
// ---------------------------------------------------------------------------

describe('review_target schema', () => {
  it('requires target field', () => {
    expect(getRequiredFields('review_target')).toContain('target')
  })

  it('has optional superpower field', () => {
    const props = getToolProperties('review_target')
    expect(props.superpower).toBeDefined()
    expect(getRequiredFields('review_target')).not.toContain('superpower')
  })

  it('has optional brief field', () => {
    const props = getToolProperties('review_target')
    expect(props.brief).toBeDefined()
    expect(getRequiredFields('review_target')).not.toContain('brief')
  })

  it('has optional lens field', () => {
    const props = getToolProperties('review_target')
    expect(props.lens).toBeDefined()
    expect(getRequiredFields('review_target')).not.toContain('lens')
  })
})

// ---------------------------------------------------------------------------
// review_target handler — invalid superpower
// ---------------------------------------------------------------------------

describe('review_target — error handling', () => {
  it('returns error for unknown superpower', async () => {
    const { handleReviewTarget } = await import('../mcp/handlers.js')
    const result = await handleReviewTarget(
      { target: '/nonexistent', superpower: 'does-not-exist' },
      '/tmp',
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown superpower')
    expect(result.content[0].text).toContain('does-not-exist')
  })

  it('returns error for nonexistent target', async () => {
    const { handleReviewTarget } = await import('../mcp/handlers.js')
    const result = await handleReviewTarget({ target: '/definitely/does/not/exist.ts' }, '/tmp')

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Failed to read target')
  })

  it('review_target returns approval message for superpowers requiring approval', async () => {
    const { handleReviewTarget } = await import('../mcp/handlers.js')
    const result = await handleReviewTarget(
      { target: 'some-file.ts', superpower: 'auto-fix-lint' },
      '/tmp',
    )

    // auto-fix-lint requires approval, so the tool should indicate this
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe('requires_approval')
    expect(parsed.message).toContain('approval')
  })
})
