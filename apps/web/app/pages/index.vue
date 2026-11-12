<script setup lang="ts">
type GameId = 'all' | 'genshin' | 'wuthering' | 'girls-frontline-2' | 'endfield'

type Game = {
  id: Exclude<GameId, 'all'>
  name: string
  shortName: string
  initials: string
  tone: string
}

type UpdatePreview = {
  id: number
  gameId: Exclude<GameId, 'all'>
  category: string
  title: string
  summary: string
  time: string
  source: string
}

const games: Game[] = [
  { id: 'genshin', name: '原神', shortName: 'GENSHIN IMPACT', initials: '原', tone: 'gold' },
  { id: 'wuthering', name: '鳴潮', shortName: 'WUTHERING WAVES', initials: '鳴', tone: 'blue' },
  { id: 'girls-frontline-2', name: '少女前線 2：追放', shortName: 'GIRLS’ FRONTLINE 2', initials: '少', tone: 'rose' },
  { id: 'endfield', name: '明日方舟：終末地', shortName: 'ARKNIGHTS: ENDFIELD', initials: '終', tone: 'green' },
]

const updatePreviews: UpdatePreview[] = [
  {
    id: 1,
    gameId: 'genshin',
    category: '版本資訊',
    title: '版本更新與活動公告',
    summary: '官方公告接入後，這裡會整理版本時間、活動內容與重要提醒。',
    time: '等待來源接入',
    source: 'HoYoverse 官方',
  },
  {
    id: 2,
    gameId: 'wuthering',
    category: '版本資訊',
    title: '版本前瞻與更新內容',
    summary: '集中查看版本更新、角色活動與遊戲維護資訊。',
    time: '等待來源接入',
    source: '鳴潮官方',
  },
  {
    id: 3,
    gameId: 'girls-frontline-2',
    category: '活動資訊',
    title: '限時活動與維護公告',
    summary: '活動日期、更新項目與維護時間將整理在同一則摘要中。',
    time: '等待來源接入',
    source: '少女前線 2 官方',
  },
  {
    id: 4,
    gameId: 'endfield',
    category: '官方消息',
    title: '測試與官方消息',
    summary: '追蹤官方釋出的測試、開發資訊與重要公告。',
    time: '等待來源接入',
    source: '終末地官方',
  },
]

const activeGame = ref<GameId>('all')
const searchQuery = ref('')
const mobileMenuOpen = ref(false)

function focusSearch() {
  document.getElementById('update-search')?.focus()
}

function handleSearchShortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
  }
}

onMounted(() => window.addEventListener('keydown', handleSearchShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', handleSearchShortcut))

const filteredUpdates = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()

  return updatePreviews.filter((update) => {
    const game = games.find((item) => item.id === update.gameId)
    const matchesGame = activeGame.value === 'all' || update.gameId === activeGame.value
    const searchableText = `${game?.name ?? ''} ${game?.shortName ?? ''} ${update.title} ${update.summary} ${update.category}`.toLocaleLowerCase()
    return matchesGame && (!query || searchableText.includes(query))
  })
})

function selectGame(id: GameId) {
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
          <span class="nav-count">04</span>
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

      <div class="side-label games-label" id="games">YOUR GAMES <span>04</span></div>
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
          <span class="game-live-dot" aria-label="尚未接入"></span>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <div class="sync-mini-card">
          <div class="sync-mini-icon"><span></span></div>
          <div><strong>來源串接準備中</strong><small>公告同步尚未啟用</small></div>
          <span class="status-dot status-dot-idle" aria-hidden="true"></span>
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
            <div class="overview-value">04<span class="value-unit"> TITLES</span></div>
            <div class="overview-foot"><span class="tiny-mark">✳</span> 原神、鳴潮、少前 2、終末地</div>
            <div class="card-accent accent-grid" aria-hidden="true"></div>
          </article>
          <article class="overview-card overview-card-sources">
            <div class="overview-topline"><span>已連接官方來源</span><span class="card-index">02 / 03</span></div>
            <div class="overview-value">00<span class="value-unit"> / 04</span></div>
            <div class="overview-foot"><span class="status-dot status-dot-idle"></span> 等待來源整理與接入</div>
            <div class="card-accent source-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          </article>
          <article class="overview-card overview-card-schedule">
            <div class="overview-topline"><span>自動整理頻率</span><span class="card-index">03 / 03</span></div>
            <div class="overview-value schedule-value">每日 <span>1–2</span> 次</div>
            <div class="overview-foot"><span class="schedule-icon">◷</span> 規劃中，排程尚未啟用</div>
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
              <button class="filter-chip" :class="{ 'filter-chip-active': activeGame === 'all' }" :aria-pressed="activeGame === 'all'" type="button" @click="selectGame('all')">全部<span>04</span></button>
              <button v-for="game in games" :key="game.id" class="filter-chip" :class="{ 'filter-chip-active': activeGame === game.id }" :aria-pressed="activeGame === game.id" type="button" @click="selectGame(game.id)">{{ game.name }}</button>
            </div>

            <div class="demo-notice"><span class="demo-notice-icon">i</span><span>介面預覽：以下為示意內容，官方公告來源與自動更新尚未接入。</span><span class="demo-notice-line"></span></div>

            <div v-if="filteredUpdates.length" class="update-list">
              <article v-for="update in filteredUpdates" :key="update.id" class="update-card">
                <div class="update-card-rail"><span class="rail-dot"></span><span class="rail-line"></span></div>
                <div class="update-card-main">
                  <div class="update-meta-row">
                    <div class="update-game-label">
                      <span class="mini-game-mark" :class="`tone-${games.find((game) => game.id === update.gameId)?.tone}`">{{ games.find((game) => game.id === update.gameId)?.initials }}</span>
                      <strong>{{ games.find((game) => game.id === update.gameId)?.name }}</strong>
                      <span class="meta-divider">/</span><span>{{ update.category }}</span>
                    </div>
                    <span class="demo-tag">示意</span>
                  </div>
                  <h3>{{ update.title }}</h3>
                  <p class="update-summary">{{ update.summary }}</p>
                  <div class="update-footer"><span class="update-source"><span class="source-symbol">↗</span>{{ update.source }}</span><span class="update-time"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>{{ update.time }}</span></div>
                </div>
                <span class="update-card-arrow" aria-hidden="true">↗</span>
              </article>
            </div>
            <div v-else class="empty-state"><span class="empty-state-symbol">⌕</span><strong>沒有符合條件的項目</strong><span>換個關鍵字，或選擇其他遊戲看看。</span></div>
          </section>

          <aside class="right-rail" aria-label="專案狀態與說明">
            <section class="rail-panel source-panel">
              <div class="rail-panel-heading"><div><span class="section-kicker">CONNECTIONS</span><h3>來源狀態</h3></div><span class="panel-ellipsis" aria-hidden="true">···</span></div>
              <div class="connection-list">
                <div v-for="game in games" :key="game.id" class="connection-row">
                  <span class="connection-game-icon" :class="`tone-${game.tone}`">{{ game.initials }}</span>
                  <div class="connection-copy"><strong>{{ game.name }}</strong><small>官方公告來源</small></div>
                  <span class="connection-status"><i></i>待接入</span>
                </div>
              </div>
              <div class="source-panel-foot"><span class="status-dot status-dot-idle"></span>尚未開始擷取公告</div>
            </section>

            <section class="rail-panel cadence-panel">
              <div class="rail-panel-heading"><div><span class="section-kicker">NEXT SYNC</span><h3>更新排程</h3></div><span class="calendar-glyph">▦</span></div>
              <div class="cadence-display"><span class="cadence-number">1–2</span><span class="cadence-copy">次<br>每天</span><span class="cadence-sun">◉</span></div>
              <div class="cadence-rule"></div>
              <p>預計每日整理一至兩次，將在來源接入後啟用。</p>
              <div class="planned-pill"><span></span> PLANNED · NOT ACTIVE</div>
            </section>

            <section id="about" class="about-note">
              <div class="about-note-top"><span class="note-star">✳</span><span>BUILT FOR YOUR BACKLOG</span></div>
              <p>少開幾個公告頁，<br>多留一點時間玩遊戲。</p>
              <span class="about-note-signature">KITSUN LAB <span>↗</span></span>
            </section>
          </aside>
        </div>

        <footer class="page-footer"><span>PATCH RADAR <span class="footer-dot">·</span> PERSONAL PROJECT</span><span>目前為 UI 原型，資料與自動同步功能尚未接入。</span><span class="footer-version">BUILD 0.1.0</span></footer>
      </div>
    </main>
  </div>
</template>
