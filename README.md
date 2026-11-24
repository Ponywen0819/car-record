# 車輛記錄（car-record）

自用的車輛狀況記錄 PWA，以 iPhone 為主要使用平台。完整規格見 [SPEC.md](SPEC.md)。

- **web**（`apps/web`）：React + Ionic（iOS 模式）PWA；手機上的 Dexie 只存快取和待上傳佇列
- **server**（`apps/server`）：Hono + PostgreSQL，同時提供網頁檔案和同步 API；資料以 server 為準
- **shared**（`packages/shared`）：zod schema、同步協定、保養項目目錄

## 開發

需要 Node 22、pnpm，以及一個可連線的 PostgreSQL（12 以上）。

```bash
pnpm install
DATABASE_URL=postgres://user:pw@localhost:5432/car_record pnpm dev:server   # API，http://localhost:8080
pnpm dev:web      # 前端，http://localhost:5173（/api 會轉送到 8080）
```

## 測試

```bash
pnpm test         # 全部：shared、server、web 單元測試 + 真實 server 整合測試
pnpm typecheck
```

server 和整合測試預設使用 [PGlite](https://pglite.dev)（編譯成 WASM 的 Postgres，在測試程序裡執行），不需要安裝 Postgres 或 Docker；每個測試使用獨立的 schema。要對真正的 Postgres 跑同一批測試：

```bash
TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres pnpm test:postgres
```

`apps/web/integration/` 會讓真正的前端同步引擎直接對真正的 server 程式碼跑測試（離線佇列、衝突、照片、重啟後資料仍在、token 驗證）。

## 正式環境

```bash
pnpm build        # apps/web/dist + apps/server/dist/main.js
pnpm start        # node apps/server/dist/main.js
```

或用 Docker（在 `deploy/` 資料夾裡）。`docker-compose.yml` 不寫死任何設定，`DATABASE_URL`、`API_TOKEN` 都從環境變數讀取：用 Dokploy 時填在 App 的 Environment 分頁；手動部署時把 `deploy/.env.example` 複製成 `deploy/.env`（已被 git 忽略）再填入。沒設定 `DATABASE_URL` 時 compose 會直接報錯。

```bash
docker compose up -d --build
```

| 環境變數 | 預設值 | 說明 |
|---|---|---|
| `DATABASE_URL` | （必填） | `postgres://user:password@host:5432/car_record`。建議用專屬的資料庫；啟動時會自動建立／升級資料表。連不上時程式直接結束，由容器的重啟策略重試 |
| `PORT` | `8080` | 純 HTTP 連接埠（HTTPS 由外部處理） |
| `DATA_DIR` | `./data`（Docker 裡是 `/data`，掛在 `car-record-data` volume） | 照片存在 `photos/` |
| `STATIC_DIR` | `apps/web/dist` | 前端 build 輸出 |
| `API_TOKEN` | （無） | 設定後 `/api/*` 需要 `Authorization: Bearer <token>`；App 的「設定 → 同步」可以填入 |

**備份**：紀錄在 Postgres（`pg_dump "$DATABASE_URL" > car-record.sql`），照片在 `DATA_DIR`，兩邊都要備份。`/healthz` 會順便檢查資料庫，連不上時回 503。

## CI

`.github/workflows/docker-publish.yml` 全部跑在自架 runner（labels：`self-hosted`、`docker`）上。推到 `develop`、`main` 和 PR 都會跑測試（先用 PGlite 跑全部，再啟動一個暫時的 `postgres:17` 容器，對真正的 Postgres 跑 server 和整合測試）；只有 `main` 和 `v*` tag 會在測試通過後建置 `linux/amd64` image 並推到 `ghcr.io/ponywen0819/car-record`。分支與版本規則見 [CLAUDE.md](CLAUDE.md)。

- runner 容器要能使用 Docker（例如掛載 `/var/run/docker.sock`），才能建置 image
- repo 是公開的：來自 fork 的 PR 不會在自架 runner 上執行

## iPhone 捷徑網址

`/add/fuel`、`/add/maintenance`、`/add/expense`、`/reminders`。可以用「捷徑」App 搭配 Siri 或 NFC 貼紙開啟。
