# Game Updates Backend

Cloudflare Worker API 與公告同步排程。前端可透過 API 取得遊戲清單、公告和各來源的同步狀態。

## API

- `GET /api/games`：啟用中的遊戲清單。
- `GET /api/updates?gameId=genshin&limit=30&offset=0`：公告列表；`gameId` 可省略，`limit` 上限為 100。
- `GET /api/sources`：公告來源、最近檢查時間、成功同步時間與狀態。
- `GET /api/health`：Worker 與 D1 的簡易健康檢查。
- `POST /api/admin/sync`：使用 `SYNC_TOKEN` Bearer token 手動同步所有啟用中的來源，回傳各來源成功與失敗數量。

回應都使用 JSON。公告保留官方文章連結；擷取失敗會更新該來源狀態並記錄在 `sync_runs`，其他來源仍會繼續同步。

## 資料來源

- 原神、鳴潮、明日方舟：終末地：各自的繁體中文官方公告頁。
- 少女前線 2：Steam 官方新聞 API。這是 Steam 平台公告，不保證涵蓋台灣伺服器的所有營運公告。

網頁公告由輕量 HTML 解析器擷取標題、連結、日期和分類；如果官方網站改版，來源狀態會顯示錯誤，需調整該遊戲的 adapter。Worker 不保存整篇公告或圖片。

## 本機開發

需求：Node.js 24 以上、pnpm 12。

```bash
pnpm install
cd apps/backend
printf 'SYNC_TOKEN="%s"\n' "$(openssl rand -hex 32)" > .dev.vars
chmod 600 .dev.vars
cd ../..
pnpm --filter game-updates-backend types
pnpm db:migrate:local
pnpm dev:backend
```

第一次本機開發時建立只供本機使用的 `.dev.vars` secret 檔；該檔已列入 `.gitignore`。Worker 預設在 `http://localhost:8787`。可手動觸發本機排程：

```bash
cd apps/backend && npx wrangler dev --test-scheduled
```

## 手動觸發正式同步

手動同步 API 需要專用的 Worker secret。首次設定時，先產生一組隨機 token（例如 `openssl rand -hex 32`），把它保存在密碼管理器，再於 backend 目錄設定：

```bash
cd apps/backend
npx wrangler secret put SYNC_TOKEN
```

Wrangler 會安全地提示輸入 token，設定後請從 repo 根目錄部署含手動同步路由的版本：

```bash
cd ../..
pnpm deploy:backend
```

之後可在 macOS zsh 終端機執行以下指令，貼上已保存的 token；token 不會寫進 repo 或 curl 命令列參數：

```zsh
read -r -s 'SYNC_TOKEN?Enter SYNC_TOKEN: '
printf '\n'
curl --config - --fail-with-body --show-error --silent <<EOF
url = "https://kitsun.cc/api/admin/sync"
request = "POST"
header = "Authorization: Bearer ${SYNC_TOKEN}"
EOF
unset SYNC_TOKEN
```

回應會列出觸發時間、來源總數、成功數與失敗數。個別來源的結果可再查 `GET /api/sources`；同步完成後重新整理 `/games`。

## 建立 Cloudflare D1 與部署

1. `pnpm db:create` 建立 `game-updates-db`，並將 Cloudflare 回傳的 `database_id` 填入 `wrangler.jsonc`。
2. 執行 `pnpm db:migrate:remote` 建立資料表與四款遊戲的初始來源設定。
3. 從 repo 根目錄執行 `pnpm deploy:backend` 部署 Worker。

Cloudflare Workers Builds 若要自動部署，Root directory 設為 `apps/backend`，Build command 使用 `pnpm install`，Deploy command 使用 `pnpm run deploy`。排程由 `wrangler.jsonc` 設定為台灣時間每天 09:00 和 21:00（Cloudflare Cron 使用 UTC）。

若 API 使用獨立的 `api.kitsun.cc` 網域，請確認 `wrangler.jsonc` 的 `CORS_ORIGINS` 包含網站來源。若改用同源 `/api/*` 路由，則不需要跨來源設定。

## 新增遊戲

新增一筆 `games` 與 `sources` 設定，並為來源選擇現有 `html-news-list` 或 `steam-news` adapter。HTML 公告文章需使用與來源頁相同網域，網址格式需包含 `/news/{數字ID}` 或 `/news/detail/{數字ID}`；若新站格式不同，新增對應 adapter。Steam adapter 會從來源 API 網址讀取 `appid`。前端透過 `/api/games` 取得遊戲清單，不必在後端建立每款遊戲各自的 Worker。
