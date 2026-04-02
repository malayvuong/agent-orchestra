import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskState, TaskStatus } from '../types/runtime.js'
import type { TaskStore } from './runtime-store.js'

/**
 * File-based TaskStore implementation.
 * Persists tasks as JSON files under: {baseDir}/tasks/{taskId}.json
 */
export class FileTaskStore implements TaskStore {
  private readonly tasksDir: string

  constructor(baseDir: string) {
    this.tasksDir = join(baseDir, 'tasks')
  }

  async create(partial: Omit<TaskState, 'taskId' | 'createdAt' | 'updatedAt'>): Promise<TaskState> {
    const now = Date.now()
    const task: TaskState = {
      ...partial,
      taskId: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    await this.save(task)
    return task
  }

  async load(taskId: string): Promise<TaskState | undefined> {
    try {
      const raw = await readFile(this.filePath(taskId), 'utf-8')
      return JSON.parse(raw) as TaskState
    } catch {
      return undefined
    }
  }

  async update(taskId: string, patch: Partial<TaskState>): Promise<TaskState> {
    const task = await this.load(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }
    const updated: TaskState = {
      ...task,
      ...patch,
      taskId: task.taskId,
      createdAt: task.createdAt,
      updatedAt: Date.now(),
    }
    await this.save(updated)
    return updated
  }

  async listBySession(sessionId: string): Promise<TaskState[]> {
    const all = await this.listAll()
    return all.filter((t) => t.sessionId === sessionId)
  }

  async listByStatus(status: TaskStatus): Promise<TaskState[]> {
    const all = await this.listAll()
    return all.filter((t) => t.status === status)
  }

  private async save(task: TaskState): Promise<void> {
    await mkdir(this.tasksDir, { recursive: true })
    await writeFile(this.filePath(task.taskId), JSON.stringify(task, null, 2), 'utf-8')
  }

  private filePath(taskId: string): string {
    return join(this.tasksDir, `${taskId}.json`)
  }

  private async listAll(): Promise<TaskState[]> {
    try {
      const entries = await readdir(this.tasksDir)
      const tasks: TaskState[] = []
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          try {
            const raw = await readFile(join(this.tasksDir, entry), 'utf-8')
            tasks.push(JSON.parse(raw) as TaskState)
          } catch {
            // skip corrupt files
          }
        }
      }
      return tasks
    } catch {
      return []
    }
  }
}
