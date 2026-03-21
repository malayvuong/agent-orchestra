import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../event-bus.js'
import type { JobUpdateEvent, ErrorEvent } from '../types.js'

describe('EventBus', () => {
  it('should emit and receive typed events', () => {
    const bus = new EventBus()
    const handler = vi.fn()

    bus.on('job:update', handler)

    const event: JobUpdateEvent = {
      type: 'job:update',
      jobId: 'job-1',
      status: 'running',
      timestamp: new Date().toISOString(),
    }

    bus.emit('job:update', event)

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('should support multiple listeners for the same event', () => {
    const bus = new EventBus()
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    bus.on('job:update', handler1)
    bus.on('job:update', handler2)

    const event: JobUpdateEvent = {
      type: 'job:update',
      jobId: 'job-1',
      status: 'completed',
      timestamp: new Date().toISOString(),
    }

    bus.emit('job:update', event)

    expect(handler1).toHaveBeenCalledOnce()
    expect(handler2).toHaveBeenCalledOnce()
  })

  it('should not receive events after off()', () => {
    const bus = new EventBus()
    const handler = vi.fn()

    bus.on('job:update', handler)
    bus.off('job:update', handler)

    const event: JobUpdateEvent = {
      type: 'job:update',
      jobId: 'job-1',
      status: 'running',
      timestamp: new Date().toISOString(),
    }

    bus.emit('job:update', event)

    expect(handler).not.toHaveBeenCalled()
  })

  it('should support different event types independently', () => {
    const bus = new EventBus()
    const jobHandler = vi.fn()
    const errorHandler = vi.fn()

    bus.on('job:update', jobHandler)
    bus.on('error', errorHandler)

    const jobEvent: JobUpdateEvent = {
      type: 'job:update',
      jobId: 'job-1',
      status: 'running',
      timestamp: new Date().toISOString(),
    }

    const errorEvent: ErrorEvent = {
      type: 'error',
      jobId: 'job-1',
      error: 'Something went wrong',
      timestamp: new Date().toISOString(),
    }

    bus.emit('job:update', jobEvent)
    bus.emit('error', errorEvent)

    expect(jobHandler).toHaveBeenCalledOnce()
    expect(jobHandler).toHaveBeenCalledWith(jobEvent)
    expect(errorHandler).toHaveBeenCalledOnce()
    expect(errorHandler).toHaveBeenCalledWith(errorEvent)
  })

  it('should support once() for single-fire listeners', () => {
    const bus = new EventBus()
    const handler = vi.fn()

    bus.once('job:update', handler)

    const event: JobUpdateEvent = {
      type: 'job:update',
      jobId: 'job-1',
      status: 'running',
      timestamp: new Date().toISOString(),
    }

    bus.emit('job:update', event)
    bus.emit('job:update', event)

    expect(handler).toHaveBeenCalledOnce()
  })

  it('should remove all listeners with removeAllListeners()', () => {
    const bus = new EventBus()
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    bus.on('job:update', handler1)
    bus.on('error', handler2)

    bus.removeAllListeners()

    bus.emit('job:update', {
      type: 'job:update',
      jobId: 'job-1',
      status: 'running',
      timestamp: new Date().toISOString(),
    })

    bus.emit('error', {
      type: 'error',
      jobId: 'job-1',
      error: 'test',
      timestamp: new Date().toISOString(),
    })

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).not.toHaveBeenCalled()
  })
})
