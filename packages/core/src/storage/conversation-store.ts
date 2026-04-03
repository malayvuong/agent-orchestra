import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRole } from '../types/agent.js'
import type { AgentMessage } from '../types/message.js'
import type { ConversationStore } from './conversation-types.js'

/**
 * File-based ConversationStore implementation.
 * Persists messages as append-only NDJSON under:
 * {baseDir}/jobs/{jobId}/conversation.jsonl
 */
export class FileConversationStore implements ConversationStore {
  private readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  async append(message: AgentMessage): Promise<void> {
    const dir = join(this.baseDir, 'jobs', message.jobId)
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, 'conversation.jsonl')
    await appendFile(filePath, JSON.stringify(message) + '\n', 'utf-8')
  }

  async loadByJob(
    jobId: string,
    filter?: {
      afterRound?: number
      role?: AgentRole
      sender?: string
    },
  ): Promise<AgentMessage[]> {
    const filePath = join(this.baseDir, 'jobs', jobId, 'conversation.jsonl')
    let messages = await this.readMessages(filePath)

    if (filter?.afterRound !== undefined) {
      messages = messages.filter((m) => m.roundIndex > filter.afterRound!)
    }
    if (filter?.role !== undefined) {
      messages = messages.filter((m) => m.role === filter.role)
    }
    if (filter?.sender !== undefined) {
      messages = messages.filter((m) => m.sender === filter.sender)
    }

    return messages
  }

  private async readMessages(filePath: string): Promise<AgentMessage[]> {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const lines = raw.trim().split('\n')
      const messages: AgentMessage[] = []
      for (const line of lines) {
        if (line.trim()) {
          try {
            messages.push(JSON.parse(line) as AgentMessage)
          } catch (err) {
            console.warn(
              `[ConversationStore] Skipping corrupt line in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }
      return messages
    } catch (err) {
      // File not found is expected (new job); other errors are worth logging
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn(
          `[ConversationStore] Error reading ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return []
    }
  }
}
