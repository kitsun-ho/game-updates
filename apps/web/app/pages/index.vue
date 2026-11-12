<script setup lang="ts">
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

const gamePresentation: Record<string, Pick<Game, 'shortName' | 'initials' | 'tone'>> = {
  genshin: { shortName: 'GENSHIN IMPACT', initials: '原', tone: 'gold' },
  wuthering: { shortName: 'WUTHERING WAVES', initials: '鳴', tone: 'blue' },
  'girls-frontline-2': { shortName: 'GIRLS’ FRONTLINE 2', initials: '少', tone: 'rose' },
  endfield: { shortName: 'ARKNIGHTS: ENDFIELD', initials: '終', tone: 'green' },
}
const fallbackTones: GameTone[] = ['gold', 'blue', 'rose', 'green']

const games = ref<Game[]>([])
const updates = ref<Update[]>([])
const sources = ref<Source[]>([])
const activeGame = ref('all')
const searchQuery = ref('')
const mobileMenuOpen = ref(false)
const isLoading = ref(true)
const apiError = ref('')

const syncedSourceCount = computed(() => sources.value.filter(source => source.status === 'ok').length)
const failedSourceCount = computed(() => sources.value.filter(source => source.status === 'error').length)
const latestSourceCheck = computed(() => {
  const timestamps = sources.value
    .map(source => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  return timestamps[timestamps.length - 1] ?? null
})

const connectionTitle = computed(() => {
  if (isLoading.value && !sources.value.length) return '正在連線資料服務'
  if (apiError.value) return '部分資料載入失敗'
  if (failedSourceCount.value) return '部分來源同步失敗'
  if (syncedSourceCount.value) return '官方來源同步正常'
  return '等待首次公告擷取'
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

const feedNotice = computed(() => {
  if (isLoading.value) return '正在從 Cloudflare API 讀取公告與來源狀態。'
  if (apiError.value) return apiError.value
  if (!updates.value.length && failedSourceCount.value) return '目前沒有公告資料，部分來源同步失敗，請查看右側來源狀態。'
  if (!updates.value.length) return '資料庫已連接；公告會在來源同步成功後顯示。'
  return `已連接資料庫，目前載入 ${updates.value.length} 則公告。`
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
  const baseUrl = apiBaseUrl()
  const [gameResult, updateResult, sourceResult] = await Promise.allSettled([
    requestApi<ApiResponse<ApiGame[]>>(baseUrl, 'games'),
    requestApi<ApiResponse<Update[]>>(baseUrl, 'updates?limit=100'),
    requestApi<ApiResponse<Source[]>>(baseUrl, 'sources'),
  ])

  const failures: string[] = []
  if (gameResult.status === 'fulfilled') games.value = gameResult.value.data.map(presentGame)
  else failures.push('遊戲清單')
  if (updateResult.status === 'fulfilled') updates.value = updateResult.value.data
  else failures.push('公告列表')
  if (sourceResult.status === 'fulfilled') sources.value = sourceResult.value.data
  else failures.push('來源狀態')

  if (failures.length) apiError.value = `無法載入${failures.join('、')}，請重試。`
  isLoading.value = false
}

function gameFor(id: string) {
  return games.value.find(game => game.id === id)
}

function gameSourceClass(id: string) {
  const statuses = sources.value.filter(source => source.gameId === id).map(source => source.status)
  if (statuses.includes('error')) return 'game-live-dot-error'
  if (statuses.includes('ok')) return 'game-live-dot-active'
  return ''
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

function handleSearchShortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleSearchShortcut)
  void refreshDashboard()
})
onBeforeUnmount(() => window.removeEventListener('keydown', handleSearchShortcut))

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
}
</script>

<template>
  <div class="dashboard-shell">
    <a class="skip-link" href="#main-content">跳到主要內容</a>

    <aside class="sidebar" :class="{ 'sidebar-open': mobileMenuOpen }" aria-label="主要導覽">
      <NuxtLink class="brand" to="/" aria-label="Patch Radar 首頁">
        <span class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </span>
        <span class="brand-copy">
          <strong>PATCH RADAR</strong>
          <small>KITSUN LAB · 01</small>
        </span>
      </NuxtLink>

      <div class="side-label">WORKSPACE</div>
      <nav class="primary-nav">
        <a class="nav-item nav-item-active" href="#main-content" aria-current="page">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/></svg>
          <span>更新總覽</span>
          <span class="nav-count">{{ games.length.toString().padStart(2, '0') }}</span>
        </a>
        <a class="nav-item" href="#games">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 8.5h9a4 4 0 0 1 3.8 5.2l-.5 1.7a2 2 0 0 1-3.3.9L14.7 14H9.3L7.5 16.3a2 2 0 0 1-3.3-.9l-.5-1.7a4 4 0 0 1 3.8-5.2Z"/><path d="M8 10.5v3M6.5 12h3M16.5 11.3h.01M18.1 13h.01"/></svg>
          <span>追蹤中的遊戲</span>
        </a>
        <a class="nav-item" href="#about">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>
          <span>專案資訊</span>
        </a>
      </nav>

      <div class="side-label games-label" id="games">YOUR GAMES <span>{{ games.length.toString().padStart(2, '0') }}</span></div>
      <nav class="game-nav" aria-label="依遊戲篩選">
        <button
          v-for="game in games"
          :key="game.id"
          class="game-nav-item"
          :class="[`tone-${game.tone}`, { 'game-nav-active': activeGame === game.id }]"
          type="button"
          @click="selectGame(game.id)"
        >
          <span class="game-avatar" aria-hidden="true">{{ game.initials }}</span>
          <span class="game-nav-copy"><strong>{{ game.name }}</strong><small>{{ game.shortName }}</small></span>
          <span class="game-live-dot" :class="gameSourceClass(game.id)" :aria-label="gameSourceClass(game.id) ? '來源已連接' : '等待首次同步'"></span>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <div class="sync-mini-card">
          <div class="sync-mini-icon"><span></span></div>
          <div><strong>{{ connectionTitle }}</strong><small>{{ connectionDetail }}</small></div>
          <span class="status-dot" :class="connectionDotClass" aria-hidden="true"></span>
        </div>
        <div class="profile-row">
          <div class="profile-avatar">K</div>
          <div class="profile-copy"><strong>Kitsun</strong><small>PERSONAL SPACE</small></div>
          <span class="profile-more" aria-hidden="true">···</span>
        </div>
      </div>
    </aside>

    <div v-if="mobileMenuOpen" class="mobile-backdrop" @click="mobileMenuOpen = false"></div>

    <main id="main-content" class="main-panel">
      <header class="topbar">
        <button class="mobile-menu-button" type="button" aria-label="開啟導覽選單" :aria-expanded="mobileMenuOpen" @click="mobileMenuOpen = !mobileMenuOpen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <div class="breadcrumbs"><span>Workspace</span><span class="crumb-slash">/</span><strong>更新總覽</strong></div>
        <div class="topbar-right">
          <span class="local-time"><span class="time-indicator"></span> TAIPEI · UTC+8</span>
          <button class="icon-button" type="button" aria-label="搜尋公告" @click="focusSearch">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.2 4.2"/></svg>
          </button>
          <div class="top-avatar" aria-label="Kitsun 個人空間">K</div>
        </div>
      </header>

      <div class="content-wrap">
        <section class="hero-section" aria-labelledby="page-title">
          <div class="hero-copy">
            <div class="eyebrow"><span class="eyebrow-line"></span> YOUR GAME UPDATE DESK <span class="eyebrow-index">/ 001</span></div>
            <h1 id="page-title">遊戲更新，<br class="mobile-break">集中看就好<span class="title-period">.</span></h1>
            <p>把你在意的版本、活動與官方公告，收進同一個更新面板。</p>
          </div>
          <div class="hero-orbit" aria-hidden="true">
            <div class="orbit-ring orbit-ring-outer"></div>
            <div class="orbit-ring orbit-ring-inner"></div>
            <div class="orbit-core"><span class="orbit-cross">+</span><span class="orbit-center"></span></div>
            <span class="orbit-node orbit-node-one"></span><span class="orbit-node orbit-node-two"></span>
            <span class="orbit-caption">SIGNAL<br>MONITOR</span>
          </div>
        </section>

        <section class="overview-grid" aria-label="追蹤狀態">
          <article class="overview-card overview-card-games">
            <div class="overview-topline"><span>追蹤遊戲</span><span class="card-index">01 / 03</span></div>
            <div class="overview-value">{{ games.length.toString().padStart(2, '0') }}<span class="value-unit"> TITLES</span></div>
            <div class="overview-foot"><span class="tiny-mark">✳</span> {{ games.map(game => game.name).join('、') || '正在載入遊戲清單' }}</div>
            <div class="card-accent accent-grid" aria-hidden="true"></div>
          </article>
          <article class="overview-card overview-card-sources">
            <div class="overview-topline"><span>已連接官方來源</span><span class="card-index">02 / 03</span></div>
            <div class="overview-value">{{ syncedSourceCount.toString().padStart(2, '0') }}<span class="value-unit"> / {{ sources.length.toString().padStart(2, '0') }}</span></div>
            <div class="overview-foot"><span class="status-dot" :class="connectionDotClass"></span> {{ connectionDetail }}</div>
            <div class="card-accent source-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          </article>
          <article class="overview-card overview-card-schedule">
            <div class="overview-topline"><span>自動整理頻率</span><span class="card-index">03 / 03</span></div>
            <div class="overview-value schedule-value">每日 <span>2</span> 次</div>
            <div class="overview-foot"><span class="schedule-icon">◷</span> 09:00、21:00 已啟用</div>
            <div class="card-accent schedule-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          </article>
        </section>

        <div class="section-heading-row">
          <div>
            <div class="section-kicker">THE FEED <span>·</span> 01</div>
            <h2>更新動態 <span class="heading-count">{{ filteredUpdates.length.toString().padStart(2, '0') }}</span></h2>
          </div>
          <label class="search-box" for="update-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.2 4.2"/></svg>
            <input id="update-search" v-model="searchQuery" type="search" placeholder="搜尋遊戲或公告..." autocomplete="off">
            <span class="search-shortcut">⌘ K</span>
          </label>
        </div>

        <div class="feed-layout">
          <section class="feed-column" aria-label="遊戲公告列表">
            <div class="filter-row" role="group" aria-label="篩選遊戲公告">
              <button class="filter-chip" :class="{ 'filter-chip-active': activeGame === 'all' }" :aria-pressed="activeGame === 'all'" type="button" @click="selectGame('all')">全部<span>{{ updates.length.toString().padStart(2, '0') }}</span></button>
              <button v-for="game in games" :key="game.id" class="filter-chip" :class="{ 'filter-chip-active': activeGame === game.id }" :aria-pressed="activeGame === game.id" type="button" @click="selectGame(game.id)">{{ game.name }}</button>
            </div>

            <div class="demo-notice" :class="{ 'notice-error': apiError }" role="status" aria-live="polite">
              <span class="demo-notice-icon">{{ apiError ? '!' : 'i' }}</span>
              <span>{{ feedNotice }}</span>
              <button v-if="apiError" class="feed-retry" type="button" :disabled="isLoading" @click="refreshDashboard">重新載入</button>
              <span v-else class="demo-notice-line"></span>
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
              <span>{{ isLoading ? '正在讀取資料庫公告。' : apiError ? '請重新載入，或稍後再試。' : updates.length ? '換個關鍵字，或選擇其他遊戲看看。' : '公告會在來源同步成功後顯示。' }}</span>
              <button v-if="apiError" class="feed-retry" type="button" :disabled="isLoading" @click="refreshDashboard">重新載入</button>
            </div>
          </section>

          <aside class="right-rail" aria-label="專案狀態與說明">
            <section class="rail-panel source-panel">
              <div class="rail-panel-heading"><div><span class="section-kicker">CONNECTIONS</span><h3>來源狀態</h3></div><span class="panel-ellipsis" aria-hidden="true">···</span></div>
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
              <div class="rail-panel-heading"><div><span class="section-kicker">NEXT SYNC</span><h3>更新排程</h3></div><span class="calendar-glyph">▦</span></div>
              <div class="cadence-display"><span class="cadence-number">2</span><span class="cadence-copy">次<br>每天</span><span class="cadence-sun">◉</span></div>
              <div class="cadence-rule"></div>
              <p>每日台灣時間 09:00 與 21:00 擷取官方公告。</p>
              <div class="planned-pill"><span></span> CRON ACTIVE · UTC+8</div>
            </section>

            <section id="about" class="about-note">
              <div class="about-note-top"><span class="note-star">✳</span><span>BUILT FOR YOUR BACKLOG</span></div>
              <p>少開幾個公告頁，<br>多留一點時間玩遊戲。</p>
              <span class="about-note-signature">KITSUN LAB <span>↗</span></span>
            </section>
          </aside>
        </div>

        <footer class="page-footer"><span>PATCH RADAR <span class="footer-dot">·</span> LIVE DATA</span><span>公告與同步狀態由 Cloudflare Worker / D1 提供。</span><span class="footer-version">API · /api</span></footer>
      </div>
    </main>
  </div>
</template>
