type SourceAdapter = 'html-news-list' | 'steam-news'

type SourceRecord = {
  id: number
  source_key: string
  game_id: string
  name: string
  adapter: SourceAdapter
  url: string
  fetch_url: string
}

type NewsItem = {
  externalId: string
  title: string
  summary: string | null
  category: string
  publishedAt: string | null
  sourceUrl: string
  canonicalUrl: string
}

type SteamNewsItem = {
  gid: string
  title: string
  url: string
  is_external_url?: boolean
  contents?: string
  date: number
}

type SteamNewsPayload = {
  appnews?: {
    newsitems?: SteamNewsItem[]
  }
}

type HoyoverseNewsItem = {
  iInfoId?: number
  sTitle?: string
  sIntro?: string
  sCategoryName?: string
  dtCreateTime?: string
}

type HoyoverseNewsPayload = {
  retcode?: number
  message?: string
  data?: {
    list?: HoyoverseNewsItem[]
  }
}

type KuroNewsItem = {
  articleId?: number
  articleTitle?: string
  articleDesc?: string
  articleType?: number
  createTime?: string
  startTime?: string
}

type KuroNewsPayload = {
  article?: KuroNewsItem[]
  articleType?: Array<{
    contentId?: number
    contentLabel?: string
  }>
}

type EndfieldBulletin = {
  cid?: string | number
  title?: string
  brief?: string
  tab?: string
  displayTime?: number
}

const GENSHIN_NEWS_API = 'https://sg-public-api-static.hoyoverse.com/content_v2_user/app/a1b1f9d3315447cc/getContentList'
const WUTHERING_NEWS_JSON = 'https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/zh-tw/MainMenu.json'

export type CollectionSummary = {
  triggeredAt: string
  sourceCount: number
  successes: number
  failures: number
}

const MAX_RESPONSE_BYTES = 1_500_000

export async function collectAllSources(env: Env, triggeredTime: number): Promise<CollectionSummary> {
  const sourceQuery = await env.DB.prepare(
    `SELECT id, source_key, game_id, name, adapter, url, fetch_url
       FROM sources
      WHERE enabled = 1
      ORDER BY id`,
  ).all<SourceRecord>()

  const triggeredAt = new Date(triggeredTime).toISOString()
  const results = await Promise.allSettled(
    sourceQuery.results.map((source) => collectOneSource(env, source)),
  )

  const successes = results.filter((result) => result.status === 'fulfilled' && result.value).length
  const failures = results.length - successes
  const summary = {
    triggeredAt,
    sourceCount: results.length,
    successes,
    failures,
  }
  console.log(JSON.stringify({
    message: 'source collection finished',
    ...summary,
  }))
  return summary
}

async function collectOneSource(env: Env, source: SourceRecord): Promise<boolean> {
  const startedAt = new Date().toISOString()

  try {
    const items = await fetchSourceItems(source)
    if (items.length === 0) {
      throw new Error('No announcement links found; the source format may have changed.')
    }

    const fetchedAt = new Date().toISOString()
    const statements = items.map((item) => env.DB.prepare(
      `INSERT INTO updates (
         id, game_id, source_id, external_id, title, summary, category,
         published_at, source_url, canonical_url, first_seen_at, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (game_id, canonical_url) DO UPDATE SET
         source_id = excluded.source_id,
         external_id = excluded.external_id,
         title = excluded.title,
         summary = COALESCE(excluded.summary, updates.summary),
         category = excluded.category,
         published_at = COALESCE(excluded.published_at, updates.published_at),
         source_url = excluded.source_url,
         fetched_at = excluded.fetched_at`,
    ).bind(
      crypto.randomUUID(),
      source.game_id,
      source.id,
      item.externalId,
      item.title,
      item.summary,
      item.category,
      item.publishedAt,
      item.sourceUrl,
      item.canonicalUrl,
      fetchedAt,
      fetchedAt,
    ))

    await env.DB.batch(statements)
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE sources
            SET last_checked_at = ?, last_success_at = ?, last_error = NULL, last_item_count = ?
          WHERE id = ?`,
      ).bind(fetchedAt, fetchedAt, items.length, source.id),
      env.DB.prepare(
        `INSERT INTO sync_runs (source_id, started_at, finished_at, status, fetched_count, upserted_count)
         VALUES (?, ?, ?, 'success', ?, ?)`,
      ).bind(source.id, startedAt, fetchedAt, items.length, items.length),
    ])

    console.log(JSON.stringify({
      message: 'source collection succeeded',
      sourceKey: source.source_key,
      fetchedCount: items.length,
    }))
    return true
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : String(error)
    const safeMessage = message.slice(0, 400)

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE sources
            SET last_checked_at = ?, last_error = ?
          WHERE id = ?`,
      ).bind(finishedAt, safeMessage, source.id),
      env.DB.prepare(
        `INSERT INTO sync_runs (source_id, started_at, finished_at, status, error_message)
         VALUES (?, ?, ?, 'error', ?)`,
      ).bind(source.id, startedAt, finishedAt, safeMessage),
    ])

    console.error(JSON.stringify({
      message: 'source collection failed',
      sourceKey: source.source_key,
      error: safeMessage,
    }))
    return false
  }
}

async function fetchSourceItems(source: SourceRecord): Promise<NewsItem[]> {
  if (source.adapter === 'steam-news') {
    return fetchSteamNews(source)
  }
  if (source.source_key === 'genshin-zh-tw') {
    return fetchGenshinNews(source)
  }
  if (source.source_key === 'wuthering-zh-tw') {
    return fetchWutheringNews(source)
  }
  if (source.source_key === 'endfield-zh-tw') {
    return fetchEndfieldNews(source)
  }
  if (source.adapter === 'html-news-list') {
    return fetchHtmlNewsList(source)
  }
  throw new Error(`Unsupported adapter: ${String(source.adapter)}`)
}

async function fetchGenshinNews(source: SourceRecord): Promise<NewsItem[]> {
  const apiUrl = new URL(GENSHIN_NEWS_API)
  apiUrl.search = new URLSearchParams({
    iAppId: '32',
    iChanId: '395',
    iPageSize: '40',
    iPage: '1',
    sLangKey: 'zh-tw',
  }).toString()

  const raw = await fetchTextFromUrl(source, apiUrl, 'application/json')
  const payload = JSON.parse(raw) as HoyoverseNewsPayload
  if (payload.retcode !== 0) {
    throw new Error(`HoYoverse news API returned ${payload.retcode ?? 'an unknown error'}: ${payload.message ?? 'no message'}`)
  }

  const pageUrl = new URL(source.fetch_url)
  const items = (payload.data?.list ?? []).flatMap((entry): NewsItem[] => {
    const title = typeof entry.sTitle === 'string' ? entry.sTitle.trim() : ''
    const id = typeof entry.iInfoId === 'number' && Number.isSafeInteger(entry.iInfoId) && entry.iInfoId > 0
      ? String(entry.iInfoId)
      : ''
    if (!id || title.length < 3) return []

    const canonicalUrl = normalizeUrl(new URL(`${pageUrl.pathname.replace(/\/+$/, '')}/detail/${id}`, pageUrl.origin))
    return [{
      externalId: id,
      title: title.slice(0, 240),
      summary: cleanSummary(entry.sIntro),
      category: classifyCategory(`${entry.sCategoryName ?? ''} ${title}`),
      publishedAt: parseSourceDate(entry.dtCreateTime),
      sourceUrl: canonicalUrl,
      canonicalUrl,
    }]
  })

  return items.slice(0, 40)
}

async function fetchWutheringNews(source: SourceRecord): Promise<NewsItem[]> {
  const feedUrl = new URL(WUTHERING_NEWS_JSON)
  feedUrl.searchParams.set('t', String(Math.floor(Date.now() / 60_000)))
  const raw = await fetchTextFromUrl(source, feedUrl, 'application/json')
  const payload = JSON.parse(raw) as KuroNewsPayload
  const articleTypes = new Map<number, string>()
  for (const item of payload.articleType ?? []) {
    if (typeof item.contentId === 'number' && typeof item.contentLabel === 'string') {
      articleTypes.set(item.contentId, item.contentLabel)
    }
  }

  const byId = new Map<string, KuroNewsItem>()
  for (const item of payload.article ?? []) {
    const id = typeof item.articleId === 'number' && Number.isSafeInteger(item.articleId) && item.articleId > 0
      ? String(item.articleId)
      : ''
    const title = typeof item.articleTitle === 'string' ? item.articleTitle.trim() : ''
    if (!id || title.length < 3) continue

    const previous = byId.get(id)
    if (!previous || (previous.articleType === 0 && item.articleType !== 0)) byId.set(id, item)
  }

  const pageUrl = new URL(source.fetch_url)
  return [...byId.entries()]
    .sort(([, a], [, b]) => (b.startTime ?? b.createTime ?? '').localeCompare(a.startTime ?? a.createTime ?? ''))
    .slice(0, 40)
    .flatMap(([id, item]): NewsItem[] => {
      const title = item.articleTitle?.trim() ?? ''
      if (!title) return []
      const canonicalPath = pageUrl.pathname.replace(/\/news\/?$/, `/news/detail/${id}`)
      const canonicalUrl = normalizeUrl(new URL(canonicalPath, pageUrl.origin))
      const typeLabel = articleTypes.get(item.articleType ?? -1) ?? ''
      return [{
        externalId: id,
        title: title.slice(0, 240),
        summary: cleanSummary(item.articleDesc),
        category: classifyCategory(`${title} ${typeLabel}`),
        publishedAt: parseSourceDate(item.startTime ?? item.createTime),
        sourceUrl: canonicalUrl,
        canonicalUrl,
      }]
    })
}

async function fetchEndfieldNews(source: SourceRecord): Promise<NewsItem[]> {
  const html = await fetchText(source, 'text/html,application/xhtml+xml')
  const bulletins = extractEndfieldBulletins(html)
  const pageUrl = new URL(source.fetch_url)

  return bulletins
    .flatMap((item): NewsItem[] => {
      const id = item.cid === undefined || item.cid === null ? '' : String(item.cid)
      const title = typeof item.title === 'string' ? item.title.trim() : ''
      if (!/^\d+$/.test(id) || title.length < 3) return []

      const canonicalUrl = normalizeUrl(new URL(`${pageUrl.pathname.replace(/\/+$/, '')}/${id}`, pageUrl.origin))
      const publishedAt = typeof item.displayTime === 'number' && Number.isFinite(item.displayTime)
        ? new Date(item.displayTime * 1000)
        : null
      return [{
        externalId: id,
        title: title.slice(0, 240),
        summary: cleanSummary(item.brief),
        category: classifyCategory(`${item.tab ?? ''} ${title}`),
        publishedAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt.toISOString() : null,
        sourceUrl: canonicalUrl,
        canonicalUrl,
      }]
    })
    .slice(0, 40)
}

function extractEndfieldBulletins(html: string): EndfieldBulletin[] {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)]
    .flatMap((match) => {
      try {
        const chunk = JSON.parse(match[1] ?? '')
        return typeof chunk === 'string' ? [chunk] : []
      } catch {
        return []
      }
    })
  const flightData = chunks.join('\n')
  const propertyIndex = flightData.indexOf('"bulletins":')
  if (propertyIndex < 0) throw new Error('Endfield page did not contain its bulletin data.')

  const arrayStart = flightData.indexOf('[', propertyIndex + '"bulletins":'.length)
  if (arrayStart < 0) throw new Error('Endfield bulletin data had an invalid format.')
  const arrayEnd = findJsonContainerEnd(flightData, arrayStart)
  if (arrayEnd < 0) throw new Error('Endfield bulletin data was incomplete.')

  const parsed: unknown = JSON.parse(flightData.slice(arrayStart, arrayEnd + 1))
  if (!Array.isArray(parsed)) throw new Error('Endfield bulletin data was not a list.')
  return parsed as EndfieldBulletin[]
}

function findJsonContainerEnd(value: string, start: number): number {
  const opening = value[start]
  if (opening !== '[' && opening !== '{') return -1

  const closing = opening === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < value.length; index += 1) {
    const char = value[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === opening) depth += 1
    else if (char === closing) {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function cleanSummary(value: string | null | undefined): string | null {
  if (!value) return null
  const summary = stripMarkup(value).slice(0, 500)
  return summary || null
}

function parseSourceDate(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return null

  const [, year, month, day, hour, minute, second] = match
  if (!year || !month || !day) return null
  const yearNumber = Number(year)
  const monthNumber = Number(month)
  const dayNumber = Number(day)
  const hourNumber = Number(hour ?? '00')
  const minuteNumber = Number(minute ?? '00')
  const secondNumber = Number(second ?? '00')
  const localDate = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber, secondNumber))
  if (
    localDate.getUTCFullYear() !== yearNumber
    || localDate.getUTCMonth() !== monthNumber - 1
    || localDate.getUTCDate() !== dayNumber
    || localDate.getUTCHours() !== hourNumber
    || localDate.getUTCMinutes() !== minuteNumber
    || localDate.getUTCSeconds() !== secondNumber
  ) return null

  const date = new Date(localDate.getTime() - 8 * 60 * 60 * 1000)
  return date.toISOString()
}

async function fetchHtmlNewsList(source: SourceRecord): Promise<NewsItem[]> {
  const html = await fetchText(source, 'text/html,application/xhtml+xml')
  const pageUrl = new URL(source.fetch_url)
  const articleLinks = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
  const itemsByUrl = new Map<string, NewsItem>()

  for (const match of articleLinks) {
    const attributes = match[1] ?? ''
    const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const rawHref = href?.[1] ?? href?.[2] ?? href?.[3]
    if (!rawHref) continue

    let articleUrl: URL
    try {
      articleUrl = new URL(decodeHtmlEntities(rawHref).replaceAll('\\/', '/'), pageUrl)
    } catch {
      continue
    }

    if (articleUrl.protocol !== 'https:' || articleUrl.hostname.toLowerCase() !== pageUrl.hostname.toLowerCase()) continue
    const articleId = articleUrl.pathname.match(/\/news\/(?:detail\/)?([0-9]+)\/?$/i)?.[1]
    if (!articleId) continue

    const innerHtml = match[2] ?? ''
    const imageAlt = innerHtml.match(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const titleAttribute = attributes.match(/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const title = decodeHtmlEntities(stripMarkup(innerHtml) || imageAlt?.[1] || imageAlt?.[2] || titleAttribute?.[1] || titleAttribute?.[2] || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (title.length < 3 || title.length > 240 || /^(NEWS|最新|公告|活動)$/i.test(title)) continue

    const matchIndex = match.index ?? 0
    const beforeStart = Math.max(0, matchIndex - 260)
    const afterEnd = Math.min(html.length, matchIndex + match[0].length + 260)
    const nearbyHtml = html.slice(beforeStart, afterEnd)
    const publishedAt = parseDateNearAnchor(nearbyHtml, matchIndex - beforeStart)
    const contextText = stripMarkup(nearbyHtml)
    const canonicalUrl = normalizeUrl(articleUrl)
    const item: NewsItem = {
      externalId: articleId,
      title,
      summary: null,
      category: classifyCategory(`${title} ${contextText}`),
      publishedAt,
      sourceUrl: canonicalUrl,
      canonicalUrl,
    }

    const previous = itemsByUrl.get(canonicalUrl)
    if (!previous || item.title.length > previous.title.length) itemsByUrl.set(canonicalUrl, item)
  }

  return [...itemsByUrl.values()].slice(0, 40)
}

async function fetchSteamNews(source: SourceRecord): Promise<NewsItem[]> {
  const raw = await fetchText(source, 'application/json')
  const payload = JSON.parse(raw) as SteamNewsPayload
  const newsItems = payload.appnews?.newsitems ?? []
  const appId = new URL(source.fetch_url).searchParams.get('appid')
  if (!appId || !/^\d+$/.test(appId)) throw new Error('Steam source URL must include a numeric appid.')

  return newsItems
    .filter((item) => typeof item.gid === 'string' && typeof item.title === 'string' && item.title.trim())
    .map((item) => {
      const fallbackUrl = `https://store.steampowered.com/news/app/${appId}/view/${encodeURIComponent(item.gid)}`
      const sourceUrl = safeSteamArticleUrl(item.url) ?? fallbackUrl
      const canonicalUrl = normalizeUrl(new URL(sourceUrl))
      const summary = decodeHtmlEntities(stripMarkup(item.contents ?? ''))
        .replace(/\[[^\]]{1,40}\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      return {
        externalId: item.gid,
        title: decodeHtmlEntities(item.title).trim().slice(0, 240),
        summary: summary ? summary.slice(0, 500) : null,
        category: classifyCategory(item.title),
        publishedAt: Number.isFinite(item.date) ? new Date(item.date * 1000).toISOString() : null,
        sourceUrl,
        canonicalUrl,
      }
    })
    .slice(0, 40)
}

async function fetchText(source: SourceRecord, accept: string): Promise<string> {
  return fetchTextFromUrl(source, new URL(source.fetch_url), accept)
}

async function fetchTextFromUrl(source: SourceRecord, sourceUrl: URL, accept: string): Promise<string> {
  if (!isSafeSourceUrl(sourceUrl)) {
    throw new Error('Source URL must use HTTPS and a public hostname.')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)
  try {
    let requestUrl = sourceUrl
    let response: Response | null = null
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      response = await fetch(requestUrl, {
        headers: {
          Accept: accept,
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.6',
          Referer: source.url,
        },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (response.status < 300 || response.status > 399) break
      const location = response.headers.get('Location')
      await response.body?.cancel()
      if (!location || redirects === 3) throw new Error('Source returned an invalid or excessive redirect.')

      const redirectUrl = new URL(location, requestUrl)
      if (!isSafeSourceUrl(redirectUrl) || redirectUrl.hostname.toLowerCase() !== sourceUrl.hostname.toLowerCase()) {
        throw new Error('Source redirected outside its configured HTTPS host.')
      }
      requestUrl = redirectUrl
    }

    if (!response) throw new Error('Source returned no response.')
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}.`)
    const finalUrl = new URL(response.url || requestUrl.href)
    if (!isSafeSourceUrl(finalUrl) || finalUrl.hostname.toLowerCase() !== sourceUrl.hostname.toLowerCase()) {
      throw new Error('Source redirected outside its configured HTTPS host.')
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error('Upstream response exceeded the size limit.')
    if (!response.body) return ''

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let totalBytes = 0
    let text = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Upstream response exceeded the size limit.')
      }
      text += decoder.decode(value, { stream: true })
    }

    return text + decoder.decode()
  } finally {
    clearTimeout(timeoutId)
  }
}

function isSafeSourceUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase()
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || /^\[[\da-f:]+\]$/i.test(hostname)
  const isLocalHostname = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
  return url.protocol === 'https:' && !url.username && !url.password && !isIpLiteral && !isLocalHostname
}

function safeSteamArticleUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const allowed = ['steamcommunity.com', 'store.steampowered.com']
    return url.protocol === 'https:' && allowed.includes(url.hostname.toLowerCase()) ? url.href : null
  } catch {
    return null
  }
}

function normalizeUrl(url: URL): string {
  const normalized = new URL(url.href)
  normalized.hash = ''
  normalized.search = ''
  return normalized.href.replace(/\/$/, '')
}

function stripMarkup(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, code: string) => {
      const codePoint = code[0]?.toLowerCase() === 'x'
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10)
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ''
    })
}

function parseDateNearAnchor(context: string, anchorIndex: number): string | null {
  const datePattern = /20\d{2}(?:[./-]\d{1,2}[./-]\d{1,2}|年\d{1,2}月\d{1,2}日)/g
  const matches = [...context.matchAll(datePattern)]
  if (matches.length === 0) return null

  const nearest = matches.sort((a, b) => Math.abs((a.index ?? 0) - anchorIndex) - Math.abs((b.index ?? 0) - anchorIndex))[0]?.[0]
  if (!nearest) return null
  const parts = nearest.match(/(20\d{2})[./年-](\d{1,2})[./月-](\d{1,2})/)
  if (!parts) return null

  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${parts[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function classifyCategory(text: string): string {
  if (/維護|更新|maintenance|patch\s*notes|update\s*(?:notice|details)|版本.{0,16}(?:更新|內容|資訊|說明)|(?:更新|維護).{0,12}(?:說明|公告)/i.test(text)) return 'version'
  if (/祈願|尋訪|卡池|招募|headhunting|banner|wish/i.test(text)) return 'gacha'
  if (/活動|event/i.test(text)) return 'event'
  if (/公告|notice/i.test(text)) return 'notice'
  return 'news'
}
