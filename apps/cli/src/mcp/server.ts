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

    switch (name) {
      case 'list_superpowers':
        return handleListSuperpowers()

      case 'review_target':
        return await handleReviewTarget(
          args as { target: string; superpower?: string; brief?: string; lens?: string },
          workspacePath,
        )

      case 'review_plan':
        return await handleReviewPlan(args as { target: string; brief?: string }, workspacePath)

      case 'show_findings':
        return await handleShowFindings(args as { jobId: string }, workspacePath)

      case 'list_skills':
        return await handleListSkills(workspacePath)

      case 'evaluate_policy':
        return await handleEvaluatePolicy(
          args as { capability: string; scope?: string | string[] },
          workspacePath,
        )

      case 'get_job':
        return await handleGetJob(args as { jobId: string }, workspacePath)

      case 'compare_runs':
        return await handleCompareRuns(args as { jobId: string }, workspacePath)

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
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
