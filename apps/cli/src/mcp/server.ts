/**
 * MCP server setup for Agent Orchestra.
 *
 * Registers tools with the MCP SDK Server and routes tool calls
 * to the appropriate handlers in handlers.ts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOL_DEFINITIONS } from './tools.js'
import { AGENT_ORCHESTRA_VERSION } from '@malayvuong/agent-orchestra-shared'
import {
  handleListSuperpowers,
  handleReviewTarget,
  handleReviewPlan,
  handleShowFindings,
  handleListSkills,
  handleEvaluatePolicy,
  handleGetJob,
  handleCompareRuns,
} from './handlers.js'

/**
 * Create and configure an MCP Server instance with all Agent Orchestra tools.
 */
export function createMcpServer(workspacePath: string): Server {
  const server = new Server(
    {
      name: 'agent-orchestra',
      version: AGENT_ORCHESTRA_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }))

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    // Runtime input validation helper
    const requireString = (field: string): string => {
      const value = (args as Record<string, unknown>)?.[field]
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Missing or invalid required field: "${field}" (expected non-empty string)`)
      }
      return value.trim()
    }

    const optionalString = (field: string): string | undefined => {
      const value = (args as Record<string, unknown>)?.[field]
      if (value === undefined || value === null) return undefined
      if (typeof value !== 'string') {
        throw new Error(`Invalid field: "${field}" (expected string)`)
      }
      return value.trim() || undefined
    }

    try {
      switch (name) {
        case 'list_superpowers':
          return handleListSuperpowers()

        case 'review_target':
          return await handleReviewTarget(
            {
              target: requireString('target'),
              superpower: optionalString('superpower'),
              brief: optionalString('brief'),
              lens: optionalString('lens'),
            },
            workspacePath,
          )

        case 'review_plan':
          return await handleReviewPlan(
            { target: requireString('target'), brief: optionalString('brief') },
            workspacePath,
          )

        case 'show_findings':
          return await handleShowFindings({ jobId: requireString('jobId') }, workspacePath)

        case 'list_skills':
          return await handleListSkills(workspacePath)

        case 'evaluate_policy': {
          const rawScope = (args as Record<string, unknown>)?.['scope']
          const scope =
            rawScope === undefined
              ? undefined
              : typeof rawScope === 'string'
                ? rawScope
                : Array.isArray(rawScope)
                  ? rawScope.filter((s): s is string => typeof s === 'string')
                  : undefined
          return await handleEvaluatePolicy(
            { capability: requireString('capability'), scope },
            workspacePath,
          )
        }

        case 'get_job':
          return await handleGetJob({ jobId: requireString('jobId') }, workspacePath)

        case 'compare_runs':
          return await handleCompareRuns({ jobId: requireString('jobId') }, workspacePath)

        default:
          return {
            content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
            isError: true,
          }
      }
    } catch (err) {
      return {
        content: [
          { type: 'text' as const, text: err instanceof Error ? err.message : String(err) },
        ],
        isError: true,
      }
    }
  })

  return server
}

/**
 * Start the MCP server with stdio transport.
 */
export async function startStdioServer(workspacePath: string): Promise<void> {
  const server = createMcpServer(workspacePath)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Log to stderr (stdout is reserved for MCP protocol)
  process.stderr.write(`Agent Orchestra MCP server running (stdio)\n`)
  process.stderr.write(`Workspace: ${workspacePath}\n`)
  process.stderr.write(`Tools: ${TOOL_DEFINITIONS.length}\n`)
}
