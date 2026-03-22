import { createServer, type ServerResponse } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadSuperpowerCatalog } from '@malayvuong/agent-orchestra-core'

const PORT = Number(process.env.PORT ?? 3100)
const STORAGE_DIR = process.env.STORAGE_DIR ?? join(process.cwd(), '.agent-orchestra')

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  // CORS headers for dashboard
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    if (url.pathname === '/health') {
      json(res, { status: 'ok', version: '0.0.1', uptime: process.uptime() })
      return
    }

    if (url.pathname === '/api/status') {
      const jobCount = await countJobs()
      json(res, {
        version: '0.0.1',
        storage: STORAGE_DIR,
        jobs: jobCount,
        node: process.version,
      })
      return
    }

    if (url.pathname === '/api/jobs' && req.method === 'GET') {
      const jobs = await listJobs()
      json(res, { jobs })
      return
    }

    if (url.pathname.startsWith('/api/jobs/') && req.method === 'GET') {
      const jobId = url.pathname.split('/')[3]
      const job = await loadJob(jobId)
      if (job) {
        json(res, job)
      } else {
        res.writeHead(404)
        json(res, { error: 'Job not found' })
      }
      return
    }

    // Superpowers endpoints
    if (url.pathname === '/api/superpowers' && req.method === 'GET') {
      const catalog = loadSuperpowerCatalog()
      const superpowers = catalog.list().map((sp) => ({
        id: sp.id,
        name: sp.name,
        category: sp.category,
        maturity: sp.maturity,
        description: sp.description,
      }))
      json(res, { superpowers })
      return
    }

    if (url.pathname.startsWith('/api/superpowers/') && req.method === 'GET') {
      const superpowerId = url.pathname.split('/')[3]
      const catalog = loadSuperpowerCatalog()
      if (!catalog.has(superpowerId)) {
        res.writeHead(404)
        json(res, { error: 'Superpower not found' })
        return
      }
      const sp = catalog.get(superpowerId)!
      json(res, sp)
      return
    }

    // Default: serve a simple status page
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html>
<html>
<head><title>Agent Orchestra</title><meta charset="utf-8"></head>
<body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px">
  <h1>Agent Orchestra</h1>
  <p>Server is running. API endpoints:</p>
  <ul>
    <li><a href="/health">/health</a> — health check</li>
    <li><a href="/api/status">/api/status</a> — server status</li>
    <li><a href="/api/jobs">/api/jobs</a> — list jobs</li>
    <li><a href="/api/superpowers">/api/superpowers</a> — list superpowers</li>
  </ul>
  <p style="color:#666">Web dashboard coming in a future release.</p>
</body>
</html>`)
      return
    }

    res.writeHead(404)
    json(res, { error: 'Not found' })
  } catch (err) {
    res.writeHead(500)
    json(res, { error: err instanceof Error ? err.message : 'Internal error' })
  }
})

server.listen(PORT, () => {
  console.log(`Agent Orchestra server listening on http://localhost:${PORT}`)
  console.log(`Storage: ${STORAGE_DIR}`)
  console.log(`\nEndpoints:`)
  console.log(`  GET /health              — health check`)
  console.log(`  GET /api/status          — server status`)
  console.log(`  GET /api/jobs            — list all jobs`)
  console.log(`  GET /api/jobs/:id        — get job details`)
  console.log(`  GET /api/superpowers     — list superpowers`)
  console.log(`  GET /api/superpowers/:id — get superpower details`)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.close(() => process.exit(0))
})

// Helpers
function json(res: ServerResponse, data: unknown) {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data, null, 2))
}

async function countJobs(): Promise<number> {
  try {
    const entries = await readdir(join(STORAGE_DIR, 'jobs'))
    return entries.length
  } catch {
    return 0
  }
}

async function listJobs(): Promise<unknown[]> {
  try {
    const jobsDir = join(STORAGE_DIR, 'jobs')
    const entries = await readdir(jobsDir)
    const jobs = []
    for (const entry of entries) {
      try {
        const raw = await readFile(join(jobsDir, entry, 'job.json'), 'utf-8')
        const job = JSON.parse(raw) as Record<string, unknown>
        jobs.push({
          id: job.id,
          title: job.title,
          status: job.status,
          protocol: job.protocol,
          createdAt: job.createdAt,
        })
      } catch {
        // skip invalid entries
      }
    }
    return jobs
  } catch {
    return []
  }
}

async function loadJob(jobId: string): Promise<unknown | null> {
  try {
    const raw = await readFile(join(STORAGE_DIR, 'jobs', jobId, 'job.json'), 'utf-8')
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}
