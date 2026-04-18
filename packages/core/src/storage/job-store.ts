import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Job, JobStatus } from '../types/job.js'
import type { JobStore } from './types.js'

/**
 * File-based JobStore implementation.
 * Persists jobs as JSON files under: {baseDir}/jobs/{jobId}/job.json
 */
export class FileJobStore implements JobStore {
  private readonly jobsDir: string

  constructor(baseDir: string) {
    this.jobsDir = join(baseDir, 'jobs')
  }

  /** Create a new job with generated UUID and 'draft' status. */
  async create(partial: Omit<Job, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<Job> {
    const now = this.nextTimestamp()
    const job: Job = {
      ...partial,
      id: randomUUID(),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }

    await this.save(job)
    return job
  }

  /** Load a job by ID. Returns undefined if the job file does not exist. */
  async load(jobId: string): Promise<Job | undefined> {
    const filePath = this.jobFilePath(jobId)
    try {
      const raw = await readFile(filePath, 'utf-8')
      return JSON.parse(raw) as Job
    } catch {
      return undefined
    }
  }

  /** Valid status transitions — prevents illegal state changes. */
  private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
    draft: ['running', 'cancelled'],
    running: ['awaiting_decision', 'failed', 'cancelled'],
    awaiting_decision: ['running', 'completed', 'cancelled'],
    failed: ['running'], // allow retry
    cancelled: [],
    completed: [],
  }

  /**
   * Update a job's status and updatedAt timestamp.
   * Uses optimistic concurrency: reads, validates transition, writes with
   * updatedAt guard. Retries once on conflict.
   */
  async updateStatus(jobId: string, status: JobStatus): Promise<Job> {
    const maxAttempts = 2
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const job = await this.load(jobId)
      if (!job) {
        throw new Error(`Job not found: ${jobId}`)
      }

      // Validate state transition
      const allowed = FileJobStore.VALID_TRANSITIONS[job.status]
      if (allowed && !allowed.includes(status)) {
        throw new Error(`Invalid status transition: ${job.status} → ${status} for job ${jobId}`)
      }

      const previousUpdatedAt = job.updatedAt
      job.status = status
      job.updatedAt = this.nextTimestamp(job.updatedAt)

      // Optimistic concurrency: re-read and check updatedAt before writing
      const current = await this.load(jobId)
      if (current && current.updatedAt !== previousUpdatedAt) {
        // Conflict — another write happened; retry
        if (attempt < maxAttempts - 1) continue
        throw new Error(`Concurrent update conflict for job ${jobId}`)
      }

      await this.save(job)
      return job
    }
    throw new Error(`Failed to update job ${jobId} after ${maxAttempts} attempts`)
  }

  /** List all jobs by scanning the jobs directory. */
  async list(): Promise<Job[]> {
    try {
      const entries = await readdir(this.jobsDir, { withFileTypes: true })
      const jobs: Job[] = []

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const job = await this.load(entry.name)
          if (job) {
            jobs.push(job)
          }
        }
      }

      return jobs
    } catch {
      // Directory does not exist yet — no jobs
      return []
    }
  }

  /** Save a full job object to disk, creating directories as needed. */
  async save(job: Job): Promise<void> {
    const dir = this.jobDir(job.id)
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, 'job.json')
    await writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8')
  }

  /** Get the directory path for a job. Validates jobId to prevent path traversal. */
  private jobDir(jobId: string): string {
    // Reject path traversal characters outright
    if (jobId.includes('/') || jobId.includes('\\') || jobId.includes('..')) {
      throw new Error(`Invalid job ID: ${jobId}`)
    }
    const dir = resolve(this.jobsDir, jobId)
    if (!dir.startsWith(this.jobsDir)) {
      throw new Error(`Job ID resolves outside jobs directory: ${jobId}`)
    }
    return dir
  }

  /** Get the file path for a job's JSON file. */
  private jobFilePath(jobId: string): string {
    return join(this.jobDir(jobId), 'job.json')
  }

  /** Ensure persisted timestamps always move forward, even within one millisecond. */
  private nextTimestamp(previousIso?: string): string {
    const nowMs = Date.now()
    if (!previousIso) {
      return new Date(nowMs).toISOString()
    }

    const previousMs = Date.parse(previousIso)
    const nextMs = Number.isNaN(previousMs) ? nowMs : Math.max(nowMs, previousMs + 1)
    return new Date(nextMs).toISOString()
  }
}
