# Game Updates

將《原神》、《鳴潮》、《少女前線 2：追放》和《明日方舟：終末地》的官方更新資訊整理在同一個地方。

目前 repo 包含 Nuxt 網站 UI 與 Cloudflare Worker 後端程式。後端尚未部署、D1 尚未建立，首頁也還沒接上 API；首頁公告列仍是示意內容，不代表即時或真實公告。

## 專案結構

```text
apps/
  web/       Nuxt 4 網站
  backend/  Cloudflare Worker API、D1 migration 與定時擷取
```

## 本機開發

需求：Node.js 24 以上、pnpm 12。

```bash
pnpm install
pnpm dev
```

開啟終端機顯示的本機網址即可預覽。Nuxt app 也可以從 `apps/web` 執行 `pnpm dev`。

後端可在另一個終端機執行 `pnpm db:migrate:local` 後，再執行 `pnpm dev:backend`。

## Cloudflare 部署方向

Cloudflare Workers Builds 可以用 `apps/web` 與 `apps/backend` 作為兩個獨立的 Root directory，分別部署網站和 API。D1 建立、migration、排程及 API 操作方式請看 [apps/backend/README.md](apps/backend/README.md)。

部署前需確認 Cloudflare 的建置環境支援 Node.js 24 與 pnpm 12，並以實際建置記錄驗證設定。
