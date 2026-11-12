import { collectAllSources } from './collector'

type GameRow = {
  id: string
  name: string
  locale: string
  officialUrl: string
  sortOrder: number
}

type UpdateRow = {
  id: string
  gameId: string
  gameName: string
  title: string
  summary: string | null
  category: string
  publishedAt: string | null
  sourceName: string
  sourceUrl: string
  firstSeenAt: string
  fetchedAt: string
}

type SourceRow = {
  sourceKey: string
  gameId: string
  gameName: string
  name: string
  url: string
  enabled: number
  status: 'pending' | 'ok' | 'error'
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  lastItemCount: number
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const isManualSync = url.pathname === '/api/admin/sync'

    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin')
      const allowedOrigins = env.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
      if (origin && !allowedOrigins.includes(origin)) {
        return json({ error: { code: 'origin_not_allowed', message: 'This origin is not allowed.' } }, 403)
      }
      return withCors(request, env, new Response(null, { status: 204 }))
    }

    if (isManualSync && request.method !== 'POST') {
      return withCors(request, env, json(
        { error: { code: 'method_not_allowed', message: 'Use POST to start a manual sync.' } },
        405,
        { Allow: 'POST, OPTIONS' },
      ))
    }
    if (!isManualSync && request.method !== 'GET') {
      return withCors(request, env, json({ error: { code: 'method_not_allowed', message: 'Only GET is supported.' } }, 405, { Allow: 'GET, OPTIONS' }))
    }

    try {
      let response: Response
      if (isManualSync) {
        response = await handleManualSync(request, env)
      } else if (url.pathname === '/api/health') {
        response = await handleHealth(env)
      } else if (url.pathname === '/api/games') {
        response = await handleGames(env)
      } else if (url.pathname === '/api/updates') {
        response = await handleUpdates(url, env)
      } else if (url.pathname === '/api/sources') {
        response = await handleSources(env)
      } else {
        response = json({ error: { code: 'not_found', message: 'API endpoint not found.' } }, 404)
      }
      return withCors(request, env, response)
    } catch (error) {
      console.error(JSON.stringify({
        message: 'API request failed',
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }))
      return withCors(request, env, json({ error: { code: 'internal_error', message: 'The request could not be completed.' } }, 500))
    }
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(collectAllSources(env, controller.scheduledTime).catch((error: unknown) => {
      console.error(JSON.stringify({
        message: 'scheduled collection failed before processing sources',
        error: error instanceof Error ? error.message : String(error),
      }))
    }))
  },
} satisfies ExportedHandler<Env>

async function handleManualSync(request: Request, env: Env): Promise<Response> {
  const syncToken = (env as Env & { SYNC_TOKEN?: string }).SYNC_TOKEN
  if (!syncToken) {
    return json({ error: { code: 'sync_not_configured', message: 'Manual sync is not configured.' } }, 503, { 'Cache-Control': 'no-store' })
  }

  const authorization = request.headers.get('Authorization') ?? ''
  const providedToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!tokensMatch(providedToken, syncToken)) {
    return json({ error: { code: 'unauthorized', message: 'A valid bearer token is required.' } }, 401, { 'Cache-Control': 'no-store' })
  }

  const summary = await collectAllSources(env, Date.now())
  const status = summary.failures === 0 ? 'success' : summary.successes === 0 ? 'failed' : 'partial'
  return json({ data: { status, ...summary } }, 200, { 'Cache-Control': 'no-store' })
}

function tokensMatch(provided: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const providedBytes = encoder.encode(provided)
  const expectedBytes = encoder.encode(expected)
  const lengthsMatch = providedBytes.byteLength === expectedBytes.byteLength
  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(providedBytes, expectedBytes)
    : !crypto.subtle.timingSafeEqual(providedBytes, providedBytes)
}

async function handleHealth(env: Env): Promise<Response> {
  await env.DB.prepare('SELECT 1 AS ok').first()
  return json({ status: 'ok' }, 200, { 'Cache-Control': 'no-store' })
}

async function handleGames(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, name, locale, official_url AS officialUrl, sort_order AS sortOrder
       FROM games
      WHERE is_active = 1
      ORDER BY sort_order, name`,
  ).all<GameRow>()
  return json({ data: result.results })
}

async function handleUpdates(url: URL, env: Env): Promise<Response> {
  const gameId = url.searchParams.get('gameId')?.trim() || null
  const limit = parseInteger(url.searchParams.get('limit'), 30, 1, 100)
  const offset = parseInteger(url.searchParams.get('offset'), 0, 0, 10_000)
  if (limit === null || offset === null) {
    return json({ error: { code: 'invalid_query', message: 'limit must be 1–100 and offset must be 0–10000.' } }, 400)
  }
  if (gameId && !/^[a-z0-9-]{1,60}$/.test(gameId)) {
    return json({ error: { code: 'invalid_game_id', message: 'gameId has an invalid format.' } }, 400)
  }

  const conditions = ['g.is_active = 1']
  const bindings: Array<string | number> = []
  if (gameId) {
    conditions.push('u.game_id = ?')
    bindings.push(gameId)
  }

  const since = url.searchParams.get('since')
  if (since) {
    const normalizedSince = normalizeDateFilter(since)
    if (!normalizedSince) return json({ error: { code: 'invalid_since', message: 'since must be an ISO date or timestamp.' } }, 400)
    conditions.push('COALESCE(u.published_at, u.first_seen_at) >= ?')
    bindings.push(normalizedSince)
  }

  const before = url.searchParams.get('before')
  if (before) {
    const normalizedBefore = normalizeDateFilter(before)
    if (!normalizedBefore) return json({ error: { code: 'invalid_before', message: 'before must be an ISO date or timestamp.' } }, 400)
    conditions.push('COALESCE(u.published_at, u.first_seen_at) < ?')
    bindings.push(normalizedBefore)
  }

  const result = await env.DB.prepare(
    `SELECT u.id,
            u.game_id AS gameId,
            g.name AS gameName,
            u.title,
            u.summary,
            u.category,
            u.published_at AS publishedAt,
            s.name AS sourceName,
            u.source_url AS sourceUrl,
            u.first_seen_at AS firstSeenAt,
            u.fetched_at AS fetchedAt
       FROM updates u
       JOIN games g ON g.id = u.game_id
       JOIN sources s ON s.id = u.source_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(u.published_at, u.first_seen_at) DESC, u.id DESC
      LIMIT ? OFFSET ?`,
  ).bind(...bindings, limit + 1, offset).all<UpdateRow>()

  const hasMore = result.results.length > limit
  return json({
    data: result.results.slice(0, limit),
    meta: { limit, offset, hasMore, nextOffset: hasMore ? offset + limit : null },
  })
}

async function handleSources(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT s.source_key AS sourceKey,
            s.game_id AS gameId,
            g.name AS gameName,
            s.name,
            s.url,
            s.enabled,
            CASE
              WHEN s.last_error IS NOT NULL THEN 'error'
              WHEN s.last_success_at IS NOT NULL THEN 'ok'
              ELSE 'pending'
            END AS status,
            s.last_checked_at AS lastCheckedAt,
            s.last_success_at AS lastSuccessAt,
            s.last_error AS lastError,
            s.last_item_count AS lastItemCount
       FROM sources s
       JOIN games g ON g.id = s.game_id
      ORDER BY g.sort_order, s.id`,
  ).all<SourceRow>()
  return json({ data: result.results })
}

function parseInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === '') return fallback
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function normalizeDateFilter(value: string): string | null {
  if (value.length > 40 || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return null
  if (value.length === 10) {
    const [year, month, day] = value.split('-').map(Number)
    const dateOnly = new Date(Date.UTC(year, month - 1, day))
    return dateOnly.getUTCFullYear() === year && dateOnly.getUTCMonth() === month - 1 && dateOnly.getUTCDate() === day
      ? value
      : null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(JSON_HEADERS)
  new Headers(headers).forEach((value, key) => responseHeaders.set(key, value))
  if (status >= 400) responseHeaders.set('Cache-Control', 'no-store')
  return Response.json(body, { status, headers: responseHeaders })
}

function withCors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get('Origin')
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
  const headers = new Headers(response.headers)

  if (origin && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
    headers.set('Access-Control-Max-Age', '86400')
    const vary = headers.get('Vary')
    if (!vary) headers.set('Vary', 'Origin')
    else if (!vary.split(',').map((value) => value.trim().toLowerCase()).includes('origin')) headers.set('Vary', `${vary}, Origin`)
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
