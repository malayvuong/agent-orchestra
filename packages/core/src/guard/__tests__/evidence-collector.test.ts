import { describe, it, expect } from 'vitest'
import { collectEvidence } from '../evidence-collector.js'
import type { ToolCallRecord } from '../../types/runtime.js'

describe('collectEvidence', () => {
  const makeTc = (overrides?: Partial<ToolCallRecord>): ToolCallRecord => ({
    id: 'tc-1',
    name: 'bash',
    startedAt: Date.now(),
    status: 'ok',
    ...overrides,
  })

  it('should return empty array for empty tool calls', () => {
    expect(collectEvidence([])).toEqual([])
  })

  it('should skip tool calls without summary', () => {
    const toolCalls = [makeTc({ name: 'bash', summary: undefined })]
    expect(collectEvidence(toolCalls)).toEqual([])
  })

  it('should skip failed tool calls', () => {
    const toolCalls = [makeTc({ status: 'error', summary: 'Error occurred' })]
    expect(collectEvidence(toolCalls)).toEqual([])
  })

  it('should skip timed-out tool calls', () => {
    const toolCalls = [makeTc({ status: 'timeout', summary: 'Timed out' })]
    expect(collectEvidence(toolCalls)).toEqual([])
  })

  it('should skip denied tool calls', () => {
    const toolCalls = [makeTc({ status: 'denied', summary: 'Access denied' })]
    expect(collectEvidence(toolCalls)).toEqual([])
  })

  it('should collect successful tool calls with summary', () => {
    const toolCalls = [makeTc({ name: 'bash', status: 'ok', summary: 'Ran npm test' })]
    const evidence = collectEvidence(toolCalls)
    expect(evidence).toHaveLength(1)
    expect(evidence[0].summary).toBe('Ran npm test')
  })

  it('should collect multiple evidence entries', () => {
    const toolCalls = [
      makeTc({ id: '1', name: 'read_file', status: 'ok', summary: 'Read package.json' }),
      makeTc({ id: '2', name: 'bash', status: 'ok', summary: 'Ran tests' }),
      makeTc({ id: '3', name: 'write_file', status: 'ok', summary: 'Wrote output' }),
    ]
    const evidence = collectEvidence(toolCalls)
    expect(evidence).toHaveLength(3)
  })

  // ─── Evidence type inference ───────────────────────────────────

  it('should infer file_read for read-related tools', () => {
    const names = ['read_file', 'file_read', 'glob', 'grep']
    for (const name of names) {
      const evidence = collectEvidence([makeTc({ name, summary: 'ok' })])
      expect(evidence[0].type).toBe('file_read')
    }
  })

  it('should infer command_result for exec-related tools', () => {
    const names = ['bash', 'exec_command', 'shell_run', 'command']
    for (const name of names) {
      const evidence = collectEvidence([makeTc({ name, summary: 'ok' })])
      expect(evidence[0].type).toBe('command_result')
    }
  })

  it('should infer spawned_run for spawn-related tools', () => {
    const names = ['spawn_worker', 'background_run', 'fork_process']
    for (const name of names) {
      const evidence = collectEvidence([makeTc({ name, summary: 'ok' })])
      expect(evidence[0].type).toBe('spawned_run')
    }
  })

  it('should infer artifact for write-related tools', () => {
    const names = ['write_file', 'save_document', 'create_file']
    for (const name of names) {
      const evidence = collectEvidence([makeTc({ name, summary: 'ok' })])
      expect(evidence[0].type).toBe('artifact')
    }
  })

  it('should default to tool_output for unknown tools', () => {
    const evidence = collectEvidence([makeTc({ name: 'my_custom_tool', summary: 'ok' })])
    expect(evidence[0].type).toBe('tool_output')
  })

  it('should mix successful and failed calls', () => {
    const toolCalls = [
      makeTc({ id: '1', name: 'read_file', status: 'ok', summary: 'Read OK' }),
      makeTc({ id: '2', name: 'bash', status: 'error', summary: 'Failed' }),
      makeTc({ id: '3', name: 'write_file', status: 'ok', summary: 'Wrote OK' }),
    ]
    const evidence = collectEvidence(toolCalls)
    expect(evidence).toHaveLength(2)
    expect(evidence[0].type).toBe('file_read')
    expect(evidence[1].type).toBe('artifact')
  })
})
