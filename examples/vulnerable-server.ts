import http from 'node:http'

const USERS_DB: Record<string, { password: string; role: string }> = {}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:3000`)

  // User registration — stores password in plaintext
  if (url.pathname === '/register' && req.method === 'POST') {
    const body = await readBody(req)
    const { username, password } = JSON.parse(body)
    USERS_DB[username] = { password, role: 'user' }
    res.end(JSON.stringify({ ok: true, password })) // leaks password in response
    return
  }

  // Login — timing-safe comparison not used
  if (url.pathname === '/login' && req.method === 'POST') {
    const body = await readBody(req)
    const { username, password } = JSON.parse(body)
    const user = USERS_DB[username]
    if (user && user.password === password) {
      res.end(JSON.stringify({ token: username + ':' + Date.now() }))
    } else {
      res.writeHead(401)
      res.end(JSON.stringify({ error: 'Invalid credentials for ' + username }))
    }
    return
  }

  // Proxy endpoint — fetches arbitrary URLs from user input
  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url')
    if (target) {
      const response = await fetch(target) // SSRF: no URL validation
      const data = await response.text()
      res.end(data)
      return
    }
  }

  // Admin check — relies on client-provided role
  if (url.pathname === '/admin') {
    const role = url.searchParams.get('role')
    if (role === 'admin') {
      res.end(JSON.stringify({ users: USERS_DB })) // exposes all passwords
    } else {
      res.writeHead(403)
      res.end('Forbidden')
    }
    return
  }

  // Search — injects user input directly into response HTML
  if (url.pathname === '/search') {
    const query = url.searchParams.get('q') ?? ''
    res.setHeader('Content-Type', 'text/html')
    res.end(`<h1>Results for: ${query}</h1>`) // XSS: unescaped user input
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
  })
}

server.listen(3000)
