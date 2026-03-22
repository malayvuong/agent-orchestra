import { describe, it, expect, vi } from 'vitest'
import { DefaultCancellationRegistry } from '../cancellation.js'

describe('DefaultCancellationRegistry', () => {
  it('should report isCancelled as false for unknown jobs', () => {
    const registry = new DefaultCancellationRegistry()
    expect(registry.isCancelled('unknown-job')).toBe(false)
  })

  it('should register handles and track job state', () => {
    const registry = new DefaultCancellationRegistry()
    const handle = { cancel: vi.fn().mockResolvedValue(undefined) }

    registry.register('job-1', 'agent-1', handle)
    expect(registry.isCancelled('job-1')).toBe(false)
  })

  it('should mark job as cancelled and invoke all registered handles', async () => {
    const registry = new DefaultCancellationRegistry()
    const handle1 = { cancel: vi.fn().mockResolvedValue(undefined) }
    const handle2 = { cancel: vi.fn().mockResolvedValue(undefined) }

    registry.register('job-1', 'agent-1', handle1)
    registry.register('job-1', 'agent-2', handle2)

    await registry.cancelJob('job-1')

    expect(registry.isCancelled('job-1')).toBe(true)
    expect(handle1.cancel).toHaveBeenCalledOnce()
    expect(handle2.cancel).toHaveBeenCalledOnce()
  })

  it('should handle cancelling a job with no registered handles', async () => {
    const registry = new DefaultCancellationRegistry()

    await registry.cancelJob('job-1')
    expect(registry.isCancelled('job-1')).toBe(true)
  })

  it('should continue cancelling remaining handles if one fails', async () => {
    const registry = new DefaultCancellationRegistry()
    const failHandle = {
      cancel: vi.fn().mockRejectedValue(new Error('cancel failed')),
    }
    const successHandle = { cancel: vi.fn().mockResolvedValue(undefined) }

    // Suppress expected stderr output
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    registry.register('job-1', 'agent-fail', failHandle)
    registry.register('job-1', 'agent-ok', successHandle)

    await registry.cancelJob('job-1')

    expect(registry.isCancelled('job-1')).toBe(true)
    expect(failHandle.cancel).toHaveBeenCalledOnce()
    expect(successHandle.cancel).toHaveBeenCalledOnce()

    stderrSpy.mockRestore()
  })

  it('should isolate cancellation state between different jobs', async () => {
    const registry = new DefaultCancellationRegistry()
    const handle1 = { cancel: vi.fn().mockResolvedValue(undefined) }
    const handle2 = { cancel: vi.fn().mockResolvedValue(undefined) }

    registry.register('job-1', 'agent-1', handle1)
    registry.register('job-2', 'agent-2', handle2)

    await registry.cancelJob('job-1')

    expect(registry.isCancelled('job-1')).toBe(true)
    expect(registry.isCancelled('job-2')).toBe(false)
    expect(handle1.cancel).toHaveBeenCalledOnce()
    expect(handle2.cancel).not.toHaveBeenCalled()
  })
})
