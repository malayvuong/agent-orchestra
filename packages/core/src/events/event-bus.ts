import { EventEmitter } from 'node:events'

/**
 * Internal prefix for event names to avoid collision with Node's
 * built-in EventEmitter 'error' event behavior.
 */
const PREFIX = 'ao:'

/**
 * Type-safe event bus for orchestration events.
 * Wraps Node's EventEmitter with typed emit/on/off methods.
 *
 * Generic over TMap: pass DebateEventMap, RuntimeEventMap, or FullEventMap
 * to constrain which events a given bus instance accepts.
 * Default is Record<string, unknown> for unparameterized usage.
 */
export class EventBus<TMap extends Record<string, unknown> = Record<string, unknown>> {
  private readonly emitter = new EventEmitter()

  /** Emit a typed event. */
  emit<T extends string & keyof TMap>(type: T, payload: TMap[T]): void {
    this.emitter.emit(PREFIX + type, payload)
  }

  /** Subscribe to a typed event. */
  on<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void {
    this.emitter.on(PREFIX + type, handler)
  }

  /** Unsubscribe from a typed event. */
  off<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void {
    this.emitter.off(PREFIX + type, handler)
  }

  /** Subscribe to a typed event for a single invocation. */
  once<T extends string & keyof TMap>(type: T, handler: (payload: TMap[T]) => void): void {
    this.emitter.once(PREFIX + type, handler)
  }

  /** Remove all listeners, optionally for a specific event type. */
  removeAllListeners(type?: string & keyof TMap): void {
    if (type) {
      this.emitter.removeAllListeners(PREFIX + type)
    } else {
      this.emitter.removeAllListeners()
    }
  }
}
