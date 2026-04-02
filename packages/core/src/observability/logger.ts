import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  timestamp: string
  level: LogLevel
  runId?: string
  sessionId?: string
  component: string
  message: string
  data?: Record<string, unknown>
}

export interface Logger {
  debug(component: string, message: string, data?: Record<string, unknown>): void
  info(component: string, message: string, data?: Record<string, unknown>): void
  warn(component: string, message: string, data?: Record<string, unknown>): void
  error(component: string, message: string, data?: Record<string, unknown>): void
  child(context: { runId?: string; sessionId?: string }): Logger
}

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error']

export class FileLogger implements Logger {
  private context: { runId?: string; sessionId?: string } = {}
  private dirEnsured = false

  constructor(
    private logPath: string,
    private minLevel: LogLevel = 'info',
  ) {}

  child(context: { runId?: string; sessionId?: string }): Logger {
    const child = new FileLogger(this.logPath, this.minLevel)
    child.context = { ...this.context, ...context }
    return child
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    this.write('debug', component, message, data)
  }
  info(component: string, message: string, data?: Record<string, unknown>): void {
    this.write('info', component, message, data)
  }
  warn(component: string, message: string, data?: Record<string, unknown>): void {
    this.write('warn', component, message, data)
  }
  error(component: string, message: string, data?: Record<string, unknown>): void {
    this.write('error', component, message, data)
  }

  private write(
    level: LogLevel,
    component: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(this.minLevel)) return
    if (!this.dirEnsured) {
      mkdirSync(dirname(this.logPath), { recursive: true })
      this.dirEnsured = true
    }
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      ...this.context,
      component,
      message,
      ...(data ? { data } : {}),
    }
    appendFileSync(this.logPath, JSON.stringify(entry) + '\n')
  }
}
