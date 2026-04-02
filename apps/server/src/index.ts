import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { unlink } from 'node:fs/promises'
import {
  FileJobStore,
  FileRoundStore,
  FileRunStore,
  FileTaskStore,
  FileSessionStore,
  FileTranscriptStore,
  FileAutomationStore,
  AutomationRunner,
  loadSuperpowerCatalog,
  listProjects,
  registerProject,
  unregisterProject,
  touchProject,
} from '@malayvuong/agent-orchestra-core'
import type { StepExecutor, WorkflowStep } from '@malayvuong/agent-orchestra-core'
import { AGENT_ORCHESTRA_VERSION } from '@malayvuong/agent-orchestra-shared'
import { serveDashboard } from './dashboard.js'

const PORT = Number(process.env.PORT ?? 3100)
const STORAGE_DIR = process.env.STORAGE_DIR ?? join(process.cwd(), '.agent-orchestra')

// ─── Stores ────────────────────────────────────────────────────────

const jobStore = new FileJobStore(STORAGE_DIR)
const roundStore = new FileRoundStore(STORAGE_DIR)
const runStore = new FileRunStore(STORAGE_DIR)
const taskStore = new FileTaskStore(STORAGE_DIR)
const sessionStore = new FileSessionStore(STORAGE_DIR)
const transcriptStore = new FileTranscriptStore(STORAGE_DIR)
const automationStore = new FileAutomationStore(STORAGE_DIR)

// ─── Helpers ───────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data, null, 2))
}

function notFound(res: ServerResponse) {
  json(res, { error: 'Not found' }, 404)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

// ─── Router ────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const method = req.method ?? 'GET'
  const path = url.pathname

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    // ── Health & status ──────────────────────────────────────
    if (path === '/health') {
      return json(res, { status: 'ok', version: AGENT_ORCHESTRA_VERSION, uptime: process.uptime() })
    }
    if (path === '/api/status') {
      const jobs = await jobStore.list()
      return json(res, {
        version: AGENT_ORCHESTRA_VERSION,
        storage: STORAGE_DIR,
        counts: { jobs: jobs.length },
        node: process.version,
      })
    }

    // ── Jobs (review) ────────────────────────────────────────
    if (path === '/api/jobs' && method === 'GET') {
      const jobs = await jobStore.list()
      const summaries = jobs.map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        protocol: j.protocol,
        mode: j.mode,
        createdAt: j.createdAt,
      }))
      summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return json(res, { jobs: summaries })
    }
    if (path.match(/^\/api\/jobs\/[^/]+$/) && method === 'GET') {
      const jobId = path.split('/')[3]
      const job = await jobStore.load(jobId)
      if (!job) return notFound(res)
      const rounds = await roundStore.listByJob(jobId)
      return json(res, { job, rounds })
    }

    // ── Runs ─────────────────────────────────────────────────
    if (path === '/api/runs' && method === 'GET') {
      const sessionId = url.searchParams.get('sessionId')
      const taskId = url.searchParams.get('taskId')
      let runs
      if (sessionId) runs = await runStore.listBySession(sessionId)
      else if (taskId) runs = await runStore.listByTask(taskId)
      else runs = await runStore.listBySession('__scan_all__').catch(() => [])
      // Fallback: scan all runs
      if (runs.length === 0 && !sessionId && !taskId) {
        runs = await scanAllRuns()
      }
      runs.sort((a, b) => b.startedAt - a.startedAt)
      return json(res, { runs })
    }
    if (path.match(/^\/api\/runs\/[^/]+$/) && method === 'GET') {
      const runId = path.split('/')[3]
      const run = await runStore.load(runId)
      if (!run) return notFound(res)
      return json(res, { run })
    }
    if (path.match(/^\/api\/runs\/[^/]+$/) && method === 'PATCH') {
      const runId = path.split('/')[3]
      const run = await runStore.load(runId)
      if (!run) return notFound(res)
      const body = JSON.parse(await readBody(req))
      if (body.status !== 'cancelled') {
        return json(res, { error: 'Only status "cancelled" is allowed' }, 400)
      }
      if (run.status !== 'running') {
        return json(res, { error: 'Can only cancel a running run' }, 400)
      }
      const updated = await runStore.update(runId, { status: 'cancelled', endedAt: Date.now() })
      return json(res, { run: updated })
    }

    // ── Tasks ────────────────────────────────────────────────
    if (path === '/api/tasks' && method === 'GET') {
      const status = url.searchParams.get('status')
      const sessionId = url.searchParams.get('sessionId')
      let tasks
      if (status)
        tasks = await taskStore.listByStatus(
          status as 'queued' | 'running' | 'blocked' | 'waiting' | 'done' | 'failed',
        )
      else if (sessionId) tasks = await taskStore.listBySession(sessionId)
      else tasks = await scanAllTasks()
      tasks.sort((a, b) => b.updatedAt - a.updatedAt)
      return json(res, { tasks })
    }
    if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'GET') {
      const taskId = path.split('/')[3]
      const task = await taskStore.load(taskId)
      if (!task) return notFound(res)
      return json(res, { task })
    }
    if (path === '/api/tasks' && method === 'POST') {
      const body = JSON.parse(await readBody(req))
      if (!body.title || !body.objective) {
        return json(res, { error: 'title and objective are required' }, 400)
      }
      const task = await taskStore.create({
        title: body.title,
        objective: body.objective,
        executionRequired: body.executionRequired ?? false,
        origin: body.origin ?? 'user',
        sessionId: body.sessionId,
        status: 'queued',
      })
      return json(res, { task }, 201)
    }
    if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'PATCH') {
      const taskId = path.split('/')[3]
      const task = await taskStore.load(taskId)
      if (!task) return notFound(res)
      const body = JSON.parse(await readBody(req))
      const allowedFields = ['status', 'blocker', 'resumeHint', 'lastEvidence'] as const
      const patch: Record<string, unknown> = {}
      for (const field of allowedFields) {
        if (body[field] !== undefined) patch[field] = body[field]
      }
      const updated = await taskStore.update(taskId, patch)
      return json(res, { task: updated })
    }
    if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'DELETE') {
      const taskId = path.split('/')[3]
      const task = await taskStore.load(taskId)
      if (!task) return notFound(res)
      if (task.status !== 'done' && task.status !== 'failed') {
        return json(res, { error: 'Can only delete tasks with status "done" or "failed"' }, 400)
      }
      await unlink(join(STORAGE_DIR, 'tasks', `${taskId}.json`))
      return json(res, { ok: true })
    }

    // ── Sessions ─────────────────────────────────────────────
    if (path === '/api/sessions' && method === 'GET') {
      const sessions = await sessionStore.list()
      sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      return json(res, { sessions })
    }
    if (path.match(/^\/api\/sessions\/[^/]+$/) && method === 'GET') {
      const sessionId = path.split('/')[3]
      const session = await sessionStore.load(sessionId)
      if (!session) return notFound(res)
      return json(res, { session })
    }
    if (path.match(/^\/api\/sessions\/[^/]+\/transcript$/) && method === 'GET') {
      const sessionId = path.split('/')[3]
      const limit = url.searchParams.get('limit')
      const entries = await transcriptStore.loadBySession(sessionId, {
        limit: limit ? parseInt(limit) : undefined,
      })
      return json(res, { entries })
    }
    if (path.match(/^\/api\/sessions\/[^/]+$/) && method === 'DELETE') {
      const sessionId = path.split('/')[3]
      const session = await sessionStore.load(sessionId)
      if (!session) return notFound(res)
      await unlink(join(STORAGE_DIR, 'sessions', `${sessionId}.json`))
      return json(res, { ok: true })
    }

    // ── Automation ───────────────────────────────────────────
    if (path === '/api/automation' && method === 'GET') {
      const jobs = await automationStore.list()
      return json(res, { jobs })
    }
    if (path.match(/^\/api\/automation\/[^/]+$/) && method === 'GET') {
      const jobId = path.split('/')[3]
      const job = await automationStore.load(jobId)
      if (!job) return notFound(res)
      return json(res, { job })
    }
    if (path.match(/^\/api\/automation\/[^/]+$/) && method === 'PATCH') {
      const jobId = path.split('/')[3]
      const job = await automationStore.load(jobId)
      if (!job) return notFound(res)
      const body = JSON.parse(await readBody(req))
      if (typeof body.enabled === 'boolean') job.enabled = body.enabled
      if (typeof body.schedule === 'string') job.schedule = body.schedule
      await automationStore.save(job)
      return json(res, { job })
    }
    if (path.match(/^\/api\/automation\/[^/]+\/logs$/) && method === 'GET') {
      const jobId = path.split('/')[3]
      const runs = await runStore.listBySession(`automation-${jobId}`)
      runs.sort((a, b) => b.startedAt - a.startedAt)
      const limit = parseInt(url.searchParams.get('limit') ?? '20')
      return json(res, { runs: runs.slice(0, limit) })
    }
    if (path === '/api/automation' && method === 'POST') {
      const body = JSON.parse(await readBody(req))
      if (!body.id || !body.name || !body.workflow) {
        return json(res, { error: 'id, name, and workflow are required' }, 400)
      }
      await automationStore.save(body)
      return json(res, { job: body }, 201)
    }
    if (path.match(/^\/api\/automation\/[^/]+\/run$/) && method === 'POST') {
      const jobId = path.split('/')[3]
      const job = await automationStore.load(jobId)
      if (!job) return notFound(res)

      const scriptExecutor: StepExecutor = {
        async execute(step: WorkflowStep, options: { timeout?: number }) {
          const command = step.config.command as string
          const timeout = options.timeout ?? step.timeoutMs ?? 30_000
          const cwd = dirname(STORAGE_DIR)
          const output = execSync(command, {
            cwd,
            timeout,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          return { summary: output.slice(0, 2000) }
        },
      }

      const executors = new Map<string, StepExecutor>()
      executors.set('script', scriptExecutor)

      const runner = new AutomationRunner(runStore, executors)
      const result = await runner.execute(
        {
          source: 'system',
          sessionId: `automation-${jobId}`,
          actorId: 'server',
          trustedMeta: { automationJob: job },
          requestedMode: 'automation',
        },
        {
          sessionId: `automation-${jobId}`,
          sessionType: 'cron',
          owner: 'server',
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        },
      )

      job.lastRunAt = Date.now()
      job.lastRunStatus = result.error ? 'failed' : 'ok'
      await automationStore.save(job)

      return json(res, { result })
    }
    if (path.match(/^\/api\/automation\/[^/]+$/) && method === 'DELETE') {
      const jobId = path.split('/')[3]
      const job = await automationStore.load(jobId)
      if (!job) return notFound(res)
      await automationStore.delete(jobId)
      return json(res, { ok: true })
    }

    // ── Projects (central registry) ────────────────────────
    if (path === '/api/projects' && method === 'GET') {
      const projects = await listProjects()
      return json(res, { projects })
    }
    if (path === '/api/projects' && method === 'POST') {
      const body = JSON.parse(await readBody(req))
      if (!body.path) {
        return json(res, { error: 'path is required' }, 400)
      }
      const project = await registerProject(body.path, {
        name: body.name,
        kind: body.kind,
        daemonPort: body.daemonPort,
        tags: body.tags,
      })
      return json(res, { project }, 201)
    }
    if (path === '/api/projects' && method === 'DELETE') {
      const body = JSON.parse(await readBody(req))
      if (!body.path) {
        return json(res, { error: 'path is required' }, 400)
      }
      const removed = await unregisterProject(body.path)
      if (!removed) return notFound(res)
      return json(res, { ok: true })
    }
    if (path === '/api/projects' && method === 'PATCH') {
      const body = JSON.parse(await readBody(req))
      if (!body.path) {
        return json(res, { error: 'path is required' }, 400)
      }
      await touchProject(body.path)
      return json(res, { ok: true })
    }

    // ── Superpowers ──────────────────────────────────────────
    if (path === '/api/superpowers' && method === 'GET') {
      const catalog = loadSuperpowerCatalog()
      const superpowers = catalog.list().map((sp) => ({
        id: sp.id,
        name: sp.name,
        category: sp.category,
        maturity: sp.maturity,
        description: sp.description,
      }))
      return json(res, { superpowers })
    }

    // ── Dashboard ────────────────────────────────────────────
    if (path === '/' || path === '/dashboard' || path.startsWith('/dashboard/')) {
      return serveDashboard(res)
    }

    notFound(res)
  } catch (err) {
    res.writeHead(500)
    json(res, { error: err instanceof Error ? err.message : 'Internal error' }, 500)
  }
})

// ─── Scan helpers (no global list on FileRunStore/FileTaskStore) ──

async function scanAllRuns() {
  const { readdir, readFile } = await import('node:fs/promises')
  try {
    const dir = join(STORAGE_DIR, 'runs')
    const entries = await readdir(dir)
    const runs = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      try {
        const raw = await readFile(join(dir, entry), 'utf-8')
        runs.push(JSON.parse(raw))
      } catch {
        /* skip */
      }
    }
    return runs
  } catch {
    return []
  }
}

async function scanAllTasks() {
  const { readdir, readFile } = await import('node:fs/promises')
  try {
    const dir = join(STORAGE_DIR, 'tasks')
    const entries = await readdir(dir)
    const tasks = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      try {
        const raw = await readFile(join(dir, entry), 'utf-8')
        tasks.push(JSON.parse(raw))
      } catch {
        /* skip */
      }
    }
    return tasks
  } catch {
    return []
  }
}

// ─── Start ─────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Agent Orchestra server listening on http://localhost:${PORT}`)
  console.log(`Storage: ${STORAGE_DIR}`)
  console.log(`Dashboard: http://localhost:${PORT}/`)
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.close(() => process.exit(0))
})
