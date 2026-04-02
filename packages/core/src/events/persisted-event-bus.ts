import { appendFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { EventBus } from './event-bus.js'
import type { OrchestraEvent, EventType, EventMap } from './types.js'

export class PersistedEventBus extends EventBus {
  private dirEnsured = false

  constructor(private logPath: string) {
    super()
  }

  // Override emit to persist before dispatching
  emit<T extends EventType>(type: T, event: EventMap[T]): void {
    this.ensureDir()
    const line = JSON.stringify({ _type: type, ...event }) + '\n'
    appendFileSync(this.logPath, line)
    super.emit(type, event)
  }

  // Replay all persisted events
  replay(handler: (type: string, event: OrchestraEvent) => void): number {
    try {
      const content = readFileSync(this.logPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        const parsed = JSON.parse(line)
        const type = parsed._type
        handler(type, parsed as OrchestraEvent)
      }
      return lines.length
    } catch {
      return 0
    }
  }

  private ensureDir(): void {
    if (!this.dirEnsured) {
      mkdirSync(dirname(this.logPath), { recursive: true })
      this.dirEnsured = true
    }
  }
}
