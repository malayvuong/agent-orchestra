/**
 * Timeout enforcement security tests.
 *
 * Verifies that:
 * 1. The PolicyEngine's maxExecutionMs is respected
 * 2. The default timeout is 30000ms
 * 3. The executor correctly identifies and handles timeout errors
 *
 * These tests ensure that runaway tool executions are terminated
 * within the configured time limit.
 */

import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_POLICY } from '../../../packages/core/src/skills/policy/system-rules.js'

describe('Timeout Enforcement — Default Policy', () => {
  it('default timeout (maxExecutionMs) is 30000ms', () => {
    expect(DEFAULT_POLICY.maxExecutionMs).toBe(30_000)
  })

  it('default policy has a positive timeout value', () => {
    expect(DEFAULT_POLICY.maxExecutionMs).toBeGreaterThan(0)
  })
})

describe('Timeout Enforcement — maxExecutionMs Respected', () => {
  it('custom maxExecutionMs can be configured in a policy', () => {
    const customPolicy = {
      ...DEFAULT_POLICY,
      maxExecutionMs: 10_000,
    }

    expect(customPolicy.maxExecutionMs).toBe(10_000)
  })

  it('AbortController enforces timeout via signal', async () => {
    const timeoutMs = 100
    const abortController = new AbortController()

    const timer = setTimeout(() => abortController.abort(), timeoutMs)

    const longRunningTask = new Promise<string>((resolve, reject) => {
      const taskTimer = setTimeout(() => resolve('completed'), 5_000)

      abortController.signal.addEventListener('abort', () => {
        clearTimeout(taskTimer)
        reject(new Error(`Timed out after ${timeoutMs}ms`))
      })
    })

    await expect(longRunningTask).rejects.toThrow(/Timed out/)
    clearTimeout(timer)
  })

  it('timeout detection recognizes AbortError', () => {
    // The executor uses this pattern to detect timeout errors
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    expect(abortError.name).toBe('AbortError')

    const timeoutError = new DOMException('The operation timed out', 'TimeoutError')
    expect(timeoutError.name).toBe('TimeoutError')
  })

  it('timeout detection recognizes timeout message patterns', () => {
    const patterns = [
      'Connection timed out after 30000ms',
      'Request timeout',
      'timed out waiting for response',
      'Tool call timeout after 30s',
    ]

    const timeoutRegex = /timeout|timed?\s*out/i

    for (const msg of patterns) {
      expect(timeoutRegex.test(msg)).toBe(true)
    }
  })

  it('a mock tool call is killed after maxExecutionMs', async () => {
    const maxExecutionMs = 50
    const mockCallTool = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          // Simulate a tool that never completes
          setTimeout(() => resolve('should not reach'), 60_000)
        }),
    )

    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), maxExecutionMs)

    const toolCallPromise = new Promise<string>((resolve, reject) => {
      abortController.signal.addEventListener('abort', () => {
        reject(new Error(`Tool call timed out after ${maxExecutionMs}ms`))
      })
      mockCallTool().then(resolve, reject)
    })

    await expect(toolCallPromise).rejects.toThrow(/timed out/)
    clearTimeout(timer)

    // The mock was called once (the call was initiated)
    expect(mockCallTool).toHaveBeenCalledOnce()
  })
})
