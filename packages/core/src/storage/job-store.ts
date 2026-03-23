import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

  /** Update a job's status and updatedAt timestamp. */
  async updateStatus(jobId: string, status: JobStatus): Promise<Job> {
    const job = await this.load(jobId)
    if (!job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    job.status = status
    job.updatedAt = this.nextTimestamp(job.updatedAt)
    await this.save(job)
    return job
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

  /** Get the directory path for a job. */
  private jobDir(jobId: string): string {
    return join(this.jobsDir, jobId)
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
