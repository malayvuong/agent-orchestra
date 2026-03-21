import { appendFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolAuditEntry, ToolAuditResult } from './types.js'

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

/** Logger interface for warnings and errors */
interface Logger {
  warn: (msg: string) => void
  error: (msg: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIT_FILE_NAME = 'tool-invocations.jsonl'

// ---------------------------------------------------------------------------
// ToolAuditLogger
// ---------------------------------------------------------------------------

/**
 * Append-only JSONL audit logger for tool invocations.
 *
 * Every tool invocation (success, failure, timeout, or denial) is logged as a
 * single JSON line in `<logDir>/tool-invocations.jsonl`.
 *
 * Writes are asynchronous (`appendFile`) so they do not block the executor
 * hot path.  Read queries (`queryByJob`, `queryBySkill`) parse the full file
 * and filter in memory — acceptable for Phase C volumes.
 */
export class ToolAuditLogger {
  private readonly filePath: string

  constructor(
    private readonly logDir: string,
    private readonly logger?: Logger,
  ) {
    this.filePath = join(logDir, AUDIT_FILE_NAME)
  }

  // -----------------------------------------------------------------------
  // Write
  // -----------------------------------------------------------------------

  /**
   * Append a single audit entry to the JSONL log file.
   *
   * Creates the log directory (recursively) if it does not exist yet.
   * Serialises the entry to a single JSON line terminated by `\n`.
   */
  async log(entry: ToolAuditEntry): Promise<void> {
    try {
      await mkdir(this.logDir, { recursive: true })
      const line = JSON.stringify(entry) + '\n'
      await appendFile(this.filePath, line, 'utf-8')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger?.error?.(`Failed to write audit log: ${message}`)
    }
  }

  // -----------------------------------------------------------------------
  // Read queries
  // -----------------------------------------------------------------------

  /**
   * Return all audit entries that belong to the given job.
   */
  async queryByJob(jobId: string): Promise<ToolAuditEntry[]> {
    const entries = await this.readAll()
    return entries.filter((e) => e.jobId === jobId)
  }

  /**
   * Return all audit entries for the given skill across all jobs.
   */
  async queryBySkill(skillId: string): Promise<ToolAuditEntry[]> {
    const entries = await this.readAll()
    return entries.filter((e) => e.skillId === skillId)
  }

  // -----------------------------------------------------------------------
  // Result truncation (static utility)
  // -----------------------------------------------------------------------

  /**
   * Truncate tool result content to `maxBytes` (default 10 KB).
   *
   * Preserves the beginning of the content and appends a `[TRUNCATED]`
   * marker when truncation occurs.
   *
   * @param content    Raw tool result string.
   * @param maxBytes   Maximum byte size before truncation (default 10240).
   * @returns A {@link ToolAuditResult} with `truncated` flag set accordingly.
   */
  static truncateResult(content: string, maxBytes: number = 10240): ToolAuditResult {
    const originalSizeBytes = Buffer.byteLength(content, 'utf-8')

    if (originalSizeBytes <= maxBytes) {
      return {
        truncated: false,
        contentType: 'text/plain',
        content,
        originalSizeBytes,
      }
    }

    // Slice by bytes: encode to Buffer, slice, then decode back.
    // Using string slice as a fast approximation; for multi-byte chars
    // we re-check after slicing.
    let sliced = Buffer.from(content, 'utf-8').subarray(0, maxBytes).toString('utf-8')

    // The subarray may have split a multi-byte character.  Remove any trailing
    // replacement character (U+FFFD) that `toString` inserts.
    if (sliced.endsWith('\ufffd')) {
      sliced = sliced.slice(0, -1)
    }

    return {
      truncated: true,
      contentType: 'text/plain',
      content: sliced + '\n...[TRUNCATED]',
      originalSizeBytes,
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Read and parse the entire JSONL audit file.
   * Skips lines that fail to parse (corrupt / partial writes).
   * Returns an empty array when the file does not exist.
   */
  private async readAll(): Promise<ToolAuditEntry[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf-8')
    } catch (err: unknown) {
      // File does not exist yet — perfectly normal on first query.
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return []
      }
      const message = err instanceof Error ? err.message : String(err)
      this.logger?.error?.(`Failed to read audit log: ${message}`)
      return []
    }

    const entries: ToolAuditEntry[] = []
    const lines = raw.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }
      try {
        entries.push(JSON.parse(trimmed) as ToolAuditEntry)
      } catch {
        // Skip malformed lines — log a warning but do not throw.
        this.logger?.warn?.(`Skipping malformed audit log line: ${trimmed.slice(0, 120)}`)
      }
    }

    return entries
  }
}
