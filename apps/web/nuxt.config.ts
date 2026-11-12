export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    baseURL: '/games/',
    head: {
      title: 'PATCH RADAR — 遊戲更新總覽',
      htmlAttrs: { lang: 'zh-Hant' },
      meta: [
        {
          name: 'description',
          content: '把常玩的遊戲更新資訊整理在同一個地方。',
        },
        { name: 'theme-color', content: '#10120f' },
      ],
    },
  },
})
