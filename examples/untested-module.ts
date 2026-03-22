/**
 * Rate limiter with sliding window algorithm.
 * No tests exist for this module.
 */

type RateLimitEntry = {
  timestamps: number[]
  blocked: boolean
}

const store = new Map<string, RateLimitEntry>()

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterMs: number | null } {
  const now = Date.now()
  let entry = store.get(key)

  if (!entry) {
    entry = { timestamps: [], blocked: false }
    store.set(key, entry)
  }

  // Slide window: remove timestamps older than windowMs
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0]
    const retryAfterMs = windowMs - (now - oldestInWindow)
    entry.blocked = true
    return { allowed: false, remaining: 0, retryAfterMs }
  }

  entry.timestamps.push(now)
  entry.blocked = false
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    retryAfterMs: null,
  }
}

export function resetRateLimit(key: string): void {
  store.delete(key)
}

export function resetAll(): void {
  store.clear()
}

/**
 * Middleware factory for Express-style request handlers.
 * Applies rate limiting per IP address.
 */
export function rateLimitMiddleware(maxRequests: number, windowMs: number) {
  return (
    req: { ip: string },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    const result = checkRateLimit(req.ip, maxRequests, windowMs)

    if (!result.allowed) {
      res.status(429).json({
        error: 'Too many requests',
        retryAfterMs: result.retryAfterMs,
      })
      return
    }

    next()
  }
}
