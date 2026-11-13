<script setup lang="ts">
const props = defineProps<{ view: 'overview' | 'project-info' }>()
const isProjectInfo = computed(() => props.view === 'project-info')

useHead(() => ({
  title: props.view === 'project-info' ? '專案資訊 — PATCH RADAR' : 'PATCH RADAR — 遊戲更新總覽',
}))

type GameTone = 'gold' | 'blue' | 'rose' | 'green'

type ApiGame = {
  id: string
  name: string
  locale: string
  officialUrl: string
  sortOrder: number
}

type Game = ApiGame & {
  shortName: string
  initials: string
  tone: GameTone
}

type Update = {
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

type Source = {
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

type ApiResponse<T> = { data: T }
type UpdatesPage = ApiResponse<Update[]> & {
  meta: {
    limit: number
    offset: number
    hasMore: boolean
    nextOffset: number | null
  }
}

const UPDATE_PAGE_SIZE = 20

const gamePresentation: Record<string, Pick<Game, 'shortName' | 'initials' | 'tone'>> = {
  genshin: { shortName: 'GENSHIN IMPACT', initials: '原', tone: 'gold' },
  wuthering: { shortName: 'WUTHERING WAVES', initials: '鳴', tone: 'blue' },
  'girls-frontline-2': { shortName: 'GIRLS’ FRONTLINE 2', initials: '少', tone: 'rose' },
  endfield: { shortName: 'ARKNIGHTS: ENDFIELD', initials: '終', tone: 'green' },
}
const fallbackTones: GameTone[] = ['gold', 'blue', 'rose', 'green']

const games = useState<Game[]>('patch-radar-games', () => [])
const updates = useState<Update[]>('patch-radar-updates', () => [])
const sources = useState<Source[]>('patch-radar-sources', () => [])
const hasMoreUpdates = useState('patch-radar-has-more-updates', () => false)
const nextUpdateOffset = useState<number | null>('patch-radar-next-update-offset', () => null)
const dashboardLoaded = useState('patch-radar-dashboard-loaded', () => false)
const activeGame = useState('patch-radar-active-game', () => 'all')
const searchQuery = ref('')
const mobileMenuOpen = ref(false)
const sidebarCollapsed = useState('patch-radar-sidebar-collapsed', () => false)
const isMobileViewport = ref(false)
const sidebarToggleLabel = computed(() => {
  if (isMobileViewport.value) return mobileMenuOpen.value ? '關閉導覽選單' : '開啟導覽選單'
  return sidebarCollapsed.value ? '展開側欄' : '收合側欄'
})
const sidebarExpanded = computed(() => isMobileViewport.value ? mobileMenuOpen.value : !sidebarCollapsed.value)
const isLoading = ref(!dashboardLoaded.value)
const isLoadingMoreUpdates = ref(false)
const apiError = useState('patch-radar-api-error', () => '')
const loadMoreError = ref('')

const syncedSourceCount = computed(() => sources.value.filter(source => source.status === 'ok').length)
const failedSourceCount = computed(() => sources.value.filter(source => source.status === 'error').length)
const latestSourceCheck = computed(() => {
  const timestamps = sources.value
    .map(source => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  return timestamps[timestamps.length - 1] ?? null
})

const connectionDetail = computed(() => {
  if (apiError.value) return '可以重新載入資料'
  if (!sources.value.length) return isLoading.value ? '正在讀取來源狀態' : '尚未取得來源資料'
  return `已同步 ${syncedSourceCount.value} / ${sources.value.length} 個來源`
})

const connectionDotClass = computed(() => {
  if (apiError.value || failedSourceCount.value) return 'status-dot-error'
  return syncedSourceCount.value ? 'status-dot-success' : 'status-dot-idle'
})

function apiBaseUrl() {
  if (window.location.hostname === 'localhost') return 'http://localhost:8787/api'
  return `${window.location.origin}/api`
}

async function requestApi<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}/${path}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`API request failed: ${response.status}`)
  return await response.json() as T
}

function presentGame(game: ApiGame, index: number): Game {
  const presentation = gamePresentation[game.id]
  return {
    ...game,
    shortName: presentation?.shortName ?? game.id.replace(/-/g, ' ').toUpperCase(),
    initials: presentation?.initials ?? Array.from(game.name)[0] ?? '?',
    tone: presentation?.tone ?? fallbackTones[index % fallbackTones.length]!,
  }
}

async function refreshDashboard() {
  isLoading.value = true
  apiError.value = ''
  loadMoreError.value = ''
  hasMoreUpdates.value = false
  nextUpdateOffset.value = null
  const baseUrl = apiBaseUrl()
  const [gameResult, updateResult, sourceResult] = await Promise.allSettled([
    requestApi<ApiResponse<ApiGame[]>>(baseUrl, 'games'),
    requestApi<UpdatesPage>(baseUrl, `updates?limit=${UPDATE_PAGE_SIZE}`),
    requestApi<ApiResponse<Source[]>>(baseUrl, 'sources'),
  ])

  const failures: string[] = []
  if (gameResult.status === 'fulfilled') games.value = gameResult.value.data.map(presentGame)
  else failures.push('遊戲清單')
  if (updateResult.status === 'fulfilled') {
    updates.value = updateResult.value.data
    hasMoreUpdates.value = updateResult.value.meta.hasMore && updateResult.value.meta.nextOffset !== null
    nextUpdateOffset.value = updateResult.value.meta.nextOffset
  } else failures.push('公告列表')
  if (sourceResult.status === 'fulfilled') sources.value = sourceResult.value.data
  else failures.push('來源狀態')

  if (failures.length) apiError.value = `無法載入${failures.join('、')}，請重試。`
  isLoading.value = false
  dashboardLoaded.value = true
}

async function loadMoreUpdates() {
  const offset = nextUpdateOffset.value
  if (isLoadingMoreUpdates.value || !hasMoreUpdates.value || offset === null) return

  isLoadingMoreUpdates.value = true
  loadMoreError.value = ''
  try {
    const page = await requestApi<UpdatesPage>(
      apiBaseUrl(),
      `updates?limit=${UPDATE_PAGE_SIZE}&offset=${offset}`,
    )
    const existingIds = new Set(updates.value.map(update => update.id))
    updates.value.push(...page.data.filter(update => !existingIds.has(update.id)))
    hasMoreUpdates.value = page.meta.hasMore && page.meta.nextOffset !== null
    nextUpdateOffset.value = page.meta.nextOffset
  } catch {
    loadMoreError.value = '載入更多公告失敗，請重試。'
  } finally {
    isLoadingMoreUpdates.value = false
  }
}

function gameFor(id: string) {
  return games.value.find(game => game.id === id)
}

function sourceStatusLabel(status: Source['status']) {
  if (status === 'ok') return '已同步'
  if (status === 'error') return '需檢查'
  return '待同步'
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    version: '版本資訊',
    gacha: '招募資訊',
    event: '活動資訊',
    notice: '公告資訊',
    news: '官方消息',
  }
  return labels[category] ?? category
}

function formatDate(value: string | null | undefined) {
  if (!value) return '時間未提供'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '時間未提供'
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function focusSearch() {
  document.getElementById('update-search')?.focus()
}

function toggleSidebar() {
  if (isMobileViewport.value) {
    mobileMenuOpen.value = !mobileMenuOpen.value
    return
  }

  sidebarCollapsed.value = !sidebarCollapsed.value
}

function syncViewportMode() {
  isMobileViewport.value = window.matchMedia('(max-width: 820px)').matches
  if (isMobileViewport.value) sidebarCollapsed.value = false
  else mobileMenuOpen.value = false
}

function handleSearchShortcut(event: KeyboardEvent) {
  if (isProjectInfo.value) return
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
  }
}

onMounted(() => {
  syncViewportMode()
  window.addEventListener('resize', syncViewportMode)
  window.addEventListener('keydown', handleSearchShortcut)
  if (!dashboardLoaded.value) void refreshDashboard()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewportMode)
  window.removeEventListener('keydown', handleSearchShortcut)
})

const filteredUpdates = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()

  return updates.value.filter((update) => {
    const game = gameFor(update.gameId)
    const matchesGame = activeGame.value === 'all' || update.gameId === activeGame.value
    const searchableText = `${game?.name ?? update.gameName} ${game?.shortName ?? ''} ${update.title} ${update.summary ?? ''} ${update.category}`.toLocaleLowerCase()
    return matchesGame && (!query || searchableText.includes(query))
  })
})

function selectGame(id: string) {
  activeGame.value = id
  mobileMenuOpen.value = false
  if (isProjectInfo.value) void navigateTo({ path: '/', hash: '#updates' })
}
</script>

<template>
  <div class="dashboard-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <a class="skip-link" href="#main-content">跳到主要內容</a>

    <aside id="primary-sidebar" class="sidebar" :class="{ 'sidebar-open': mobileMenuOpen }" aria-label="主要導覽">
      <div class="sidebar-header">
        <NuxtLink class="brand" to="/" aria-label="Patch Radar 首頁" title="Patch Radar 首頁">
          <span class="brand-mark" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </span>
          <span class="brand-copy">
            <strong>PATCH RADAR</strong>
            <small>KITSUN LAB</small>
          </span>
        </NuxtLink>
        <button class="sidebar-toggle" type="button" :aria-label="sidebarToggleLabel" :title="sidebarToggleLabel" :aria-expanded="sidebarExpanded" aria-controls="primary-sidebar" @click="toggleSidebar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>

      <nav class="primary-nav">
        <NuxtLink class="nav-item" :class="{ 'nav-item-active': !isProjectInfo }" to="/" aria-label="更新總覽" title="更新總覽" :aria-current="!isProjectInfo ? 'page' : undefined" @click="mobileMenuOpen = false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/></svg>
          <span>更新總覽</span>
        </NuxtLink>
      </nav>

      <div class="side-label games-label">遊戲篩選 <span>{{ games.length.toString().padStart(2, '0') }}</span></div>
      <nav class="game-nav" aria-label="依遊戲篩選">
        <button
          v-for="game in games"
          :key="game.id"
          class="game-nav-item"
          :class="[`tone-${game.tone}`, { 'game-nav-active': activeGame === game.id }]"
          :aria-label="`${game.name}更新篩選`"
          :title="game.name"
          type="button"
          @click="selectGame(game.id)"
        >
          <span class="game-avatar" aria-hidden="true">{{ game.initials }}</span>
          <span class="game-nav-copy"><strong>{{ game.name }}</strong><small>{{ game.shortName }}</small></span>
        </button>
      </nav>

      <nav class="sidebar-bottom" aria-label="其他導覽">
        <NuxtLink class="nav-item" :class="{ 'nav-item-active': isProjectInfo }" to="/project-info" aria-label="專案資訊" title="專案資訊" :aria-current="isProjectInfo ? 'page' : undefined" @click="mobileMenuOpen = false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>
          <span>專案資訊</span>
        </NuxtLink>
      </nav>
    </aside>

    <button v-if="isMobileViewport && !mobileMenuOpen" class="mobile-sidebar-trigger" type="button" :aria-label="sidebarToggleLabel" :title="sidebarToggleLabel" aria-expanded="false" aria-controls="primary-sidebar" @click="toggleSidebar">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <div v-if="mobileMenuOpen" class="mobile-backdrop" @click="mobileMenuOpen = false"></div>

    <main id="main-content" class="main-panel">
      <div class="content-wrap">
        <section class="hero-section" aria-labelledby="page-title">
          <div class="hero-copy">
            <h1 v-if="isProjectInfo" id="page-title">專案資訊</h1>
            <h1 v-else id="page-title">遊戲更新，<br class="mobile-break">集中看就好</h1>
            <p v-if="isProjectInfo">查看追蹤遊戲、公告來源、同步狀態與專案運作方式。</p>
            <p v-else>把你在意的版本、活動與官方公告，收進同一個更新面板。</p>
          </div>
          <div class="hero-orbit" aria-hidden="true">
            <div class="orbit-ring orbit-ring-outer"></div>
            <div class="orbit-ring orbit-ring-inner"></div>
            <div class="orbit-core"><span class="orbit-cross">+</span><span class="orbit-center"></span></div>
            <span class="orbit-node orbit-node-one"></span><span class="orbit-node orbit-node-two"></span>
            <span class="orbit-caption">{{ isProjectInfo ? 'PROJECT' : 'SIGNAL' }}<br>{{ isProjectInfo ? 'STATUS' : 'MONITOR' }}</span>
          </div>
        </section>

        <section v-if="isProjectInfo" class="overview-grid" aria-label="專案運作摘要">
          <article class="overview-card overview-card-games">
            <div class="overview-topline"><span>追蹤遊戲</span></div>
            <div class="overview-value">{{ games.length.toString().padStart(2, '0') }}<span class="value-unit"> TITLES</span></div>
            <div class="overview-foot"><span class="tiny-mark">✳</span> {{ games.map(game => game.name).join('、') || '正在載入遊戲清單' }}</div>
            <div class="card-accent accent-grid" aria-hidden="true"></div>
          </article>
          <article class="overview-card overview-card-sources">
            <div class="overview-topline"><span>已連接官方來源</span></div>
            <div class="overview-value">{{ syncedSourceCount.toString().padStart(2, '0') }}<span class="value-unit"> / {{ sources.length.toString().padStart(2, '0') }}</span></div>
            <div class="overview-foot"><span class="status-dot" :class="connectionDotClass"></span> {{ connectionDetail }}</div>
            <div class="card-accent source-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          </article>
        </section>

        <section v-if="isProjectInfo" class="project-info-grid" aria-label="專案來源、排程與說明">
          <section class="rail-panel source-panel">
            <div class="rail-panel-heading">
              <div><span class="section-kicker">CONNECTIONS</span><h2>來源狀態</h2></div>
              <button v-if="apiError" class="feed-retry" type="button" :disabled="isLoading" @click="refreshDashboard">重新載入</button>
            </div>
            <div class="connection-list">
              <div v-for="source in sources" :key="source.sourceKey" class="connection-row">
                <span class="connection-game-icon" :class="`tone-${gameFor(source.gameId)?.tone ?? 'green'}`">{{ gameFor(source.gameId)?.initials ?? Array.from(source.gameName)[0] }}</span>
                <div class="connection-copy"><strong>{{ source.gameName }}</strong><small>{{ source.name }}</small></div>
                <span class="connection-status" :class="`connection-status-${source.status}`"><i></i>{{ sourceStatusLabel(source.status) }}</span>
              </div>
              <div v-if="!sources.length" class="connection-empty">{{ isLoading ? '正在載入來源…' : '目前無來源資料' }}</div>
            </div>
            <div class="source-panel-foot"><span class="status-dot" :class="connectionDotClass"></span>{{ latestSourceCheck ? `最近檢查：${formatDate(latestSourceCheck)}` : isLoading ? '正在讀取同步狀態' : '等待首次排程擷取' }}</div>
          </section>

          <section class="rail-panel cadence-panel">
            <div class="rail-panel-heading"><div><span class="section-kicker">NEXT SYNC</span><h2>更新排程</h2></div><span class="calendar-glyph">▦</span></div>
            <div class="cadence-display"><span class="cadence-number">2</span><span class="cadence-copy">次<br>每天</span><span class="cadence-sun">◉</span></div>
            <div class="cadence-rule"></div>
            <p>每日台灣時間 09:00 與 21:00 擷取官方公告。</p>
            <div class="planned-pill"><span></span> CRON ACTIVE · UTC+8</div>
          </section>

          <section class="rail-panel project-stack-panel">
            <div class="rail-panel-heading"><div><span class="section-kicker">PLATFORM</span><h2>專案架構</h2></div></div>
            <dl class="project-stack-list">
              <div><dt>前端</dt><dd>Nuxt</dd></div>
              <div><dt>API</dt><dd>Cloudflare Workers</dd></div>
              <div><dt>資料庫</dt><dd>Cloudflare D1</dd></div>
            </dl>
          </section>

          <section class="about-note">
            <div class="about-note-top"><span class="note-star">✳</span><span>BUILT FOR YOUR BACKLOG</span></div>
            <p>少開幾個公告頁，<br>多留一點時間玩遊戲。</p>
            <span class="about-note-signature">KITSUN LAB <span>↗</span></span>
          </section>
        </section>

        <section v-else id="updates" class="updates-view" aria-label="遊戲更新總覽">
          <div class="section-heading-row">
            <div>
              <h2>更新動態</h2>
            </div>
            <label class="search-box" for="update-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.2 4.2"/></svg>
              <input id="update-search" v-model="searchQuery" type="search" placeholder="搜尋遊戲或公告..." autocomplete="off">
              <span class="search-shortcut">⌘ K</span>
            </label>
          </div>

          <div class="filter-row" role="group" aria-label="篩選遊戲公告">
            <button class="filter-chip" :class="{ 'filter-chip-active': activeGame === 'all' }" :aria-pressed="activeGame === 'all'" type="button" @click="selectGame('all')">全部</button>
            <button v-for="game in games" :key="game.id" class="filter-chip" :class="{ 'filter-chip-active': activeGame === game.id }" :aria-pressed="activeGame === game.id" type="button" @click="selectGame(game.id)">{{ game.name }}</button>
          </div>

          <div v-if="filteredUpdates.length" class="update-list">
            <article v-for="update in filteredUpdates" :key="update.id" class="update-card">
              <div class="update-card-rail"><span class="rail-dot"></span><span class="rail-line"></span></div>
              <div class="update-card-main">
                <div class="update-meta-row">
                  <div class="update-game-label">
                    <span class="mini-game-mark" :class="`tone-${gameFor(update.gameId)?.tone ?? 'green'}`">{{ gameFor(update.gameId)?.initials ?? Array.from(update.gameName)[0] }}</span>
                    <strong>{{ gameFor(update.gameId)?.name ?? update.gameName }}</strong>
                    <span class="meta-divider">/</span><span>{{ categoryLabel(update.category) }}</span>
                  </div>
                </div>
                <h3><a :href="update.sourceUrl" target="_blank" rel="noopener noreferrer">{{ update.title }}</a></h3>
                <p class="update-summary">{{ update.summary || '開啟官方公告查看完整內容。' }}</p>
                <div class="update-footer"><a class="update-source" :href="update.sourceUrl" target="_blank" rel="noopener noreferrer"><span class="source-symbol">↗</span>{{ update.sourceName }}</a><span class="update-time"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>{{ formatDate(update.publishedAt || update.firstSeenAt) }}</span></div>
              </div>
              <span class="update-card-arrow" aria-hidden="true">↗</span>
            </article>
          </div>
          <div v-else class="empty-state">
            <span class="empty-state-symbol">{{ isLoading ? '◌' : apiError ? '!' : '⌕' }}</span>
            <strong>{{ isLoading ? '載入公告中' : apiError ? '公告資料載入失敗' : updates.length ? '沒有符合條件的項目' : '目前尚無公告' }}</strong>
            <span>{{ isLoading ? '正在讀取資料庫公告。' : apiError ? '請重新載入，或稍後再試。' : updates.length && hasMoreUpdates ? '目前載入的公告中沒有符合條件的項目，可以載入更多看看。' : updates.length ? '換個關鍵字，或選擇其他遊戲看看。' : '公告會在來源同步成功後顯示。' }}</span>
            <button v-if="apiError" class="feed-retry" type="button" :disabled="isLoading" @click="refreshDashboard">重新載入</button>
          </div>

          <div v-if="hasMoreUpdates || loadMoreError" class="pagination-controls">
            <button class="load-more-button" type="button" :disabled="isLoadingMoreUpdates" :aria-busy="isLoadingMoreUpdates" @click="loadMoreUpdates">
              {{ isLoadingMoreUpdates ? '載入中…' : loadMoreError ? '載入失敗，點擊重試' : '載入更多公告' }}
            </button>
            <span v-if="loadMoreError" class="pagination-error" role="status">{{ loadMoreError }}</span>
          </div>
        </section>

        <footer v-if="isProjectInfo" class="page-footer"><span>PATCH RADAR</span><span>公告與同步狀態由 Cloudflare Worker / D1 提供。</span><span class="footer-version">API · /api</span></footer>
      </div>
    </main>
  </div>
</template>
