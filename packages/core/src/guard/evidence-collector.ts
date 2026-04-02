/**
 * Evidence collector (Phase 2).
 *
 * Inspects tool call results and creates typed evidence entries.
 * Guard consumers call collectEvidence(run.toolCalls) to populate
 * TurnOutput.evidence without manual assembly.
 */

import type { ToolCallRecord } from '../types/runtime.js'

export type Evidence = {
  type: 'tool_output' | 'file_read' | 'command_result' | 'spawned_run' | 'artifact'
  summary: string
}

/**
 * Extract evidence from completed tool calls.
 * Only successful tool calls with a summary count as evidence.
 */
export function collectEvidence(toolCalls: ToolCallRecord[]): Evidence[] {
  return toolCalls
    .filter((tc) => tc.status === 'ok' && tc.summary)
    .map((tc) => ({
      type: inferEvidenceType(tc.name),
      summary: tc.summary!,
    }))
}

function inferEvidenceType(toolName: string): Evidence['type'] {
  const name = toolName.toLowerCase()
  if (
    name.includes('read') ||
    name.includes('file_read') ||
    name.includes('glob') ||
    name.includes('grep')
  ) {
    return 'file_read'
  }
  if (
    name.includes('exec') ||
    name.includes('command') ||
    name.includes('bash') ||
    name.includes('shell')
  ) {
    return 'command_result'
  }
  if (name.includes('spawn') || name.includes('background') || name.includes('fork')) {
    return 'spawned_run'
  }
  if (name.includes('write') || name.includes('save') || name.includes('create_file')) {
    return 'artifact'
  }
  return 'tool_output'
}
