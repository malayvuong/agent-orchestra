import { EventEmitter } from 'node:events'
import type { EventMap, EventType } from './types.js'

/**
 * Internal prefix for event names to avoid collision with Node's
 * built-in EventEmitter 'error' event behavior.
 */
const PREFIX = 'ao:'

/**
 * Type-safe event bus for orchestration events.
 * Wraps Node's EventEmitter with typed emit/on/off methods.
 */
export class EventBus {
  private readonly emitter = new EventEmitter()

  /** Emit a typed event. */
  emit<T extends EventType>(type: T, payload: EventMap[T]): void {
    this.emitter.emit(PREFIX + type, payload)
  }

  /** Subscribe to a typed event. */
  on<T extends EventType>(type: T, handler: (payload: EventMap[T]) => void): void {
    this.emitter.on(PREFIX + type, handler)
  }

  /** Unsubscribe from a typed event. */
  off<T extends EventType>(type: T, handler: (payload: EventMap[T]) => void): void {
    this.emitter.off(PREFIX + type, handler)
  }

  /** Subscribe to a typed event for a single invocation. */
  once<T extends EventType>(type: T, handler: (payload: EventMap[T]) => void): void {
    this.emitter.once(PREFIX + type, handler)
  }

  /** Remove all listeners, optionally for a specific event type. */
  removeAllListeners(type?: EventType): void {
    if (type) {
      this.emitter.removeAllListeners(PREFIX + type)
    } else {
      this.emitter.removeAllListeners()
    }
  }
}
