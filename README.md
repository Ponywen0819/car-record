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

或用 Docker（在 `deploy/` 資料夾裡）。`docker-compose.yml` 不寫死任何設定，`DATABASE_URL`、`API_TOKEN` 都從 `deploy/.env`（已被 git 忽略，由 `deploy/.env.example` 複製後填入）讀取；沒設定 `DATABASE_URL` 時 compose 會直接報錯。本機自建映像可用：

```bash
docker compose up -d --build
```

### 自動部署與一次性設定

正式環境採用推送式自動部署（完整設計與疑難排解見 [`Ponywen0819/service-core` 的 `deploy/README.md`](https://github.com/Ponywen0819/service-core/blob/main/deploy/README.md)）：

- **自動部署流程**：推送 `vX.Y.Z` tag 後，CI 會建置並推送 `:vX.Y.Z` 映像，接著呼叫 `service-core` 的共用 deploy workflow，透過 SSH 連上 host 執行 `deploy/deploy.sh vX.Y.Z`（將 repo 切到該 tag、拉映像、更新 `deploy/.env` 的 `APP_TAG`、啟動容器並確認 healthy）。
- **手動重部署／退版**：到 GitHub `Actions → deploy → Run workflow` 輸入已建過映像的 `vX.Y.Z` tag（此 workflow 合併至預設分支 `main` 後才會顯示），或直接在 host 執行 `/root/car-record/deploy/deploy.sh vX.Y.Z`。
- **一次性設定**：
  - 在 host 上 clone 此 repo（例如 `git clone https://github.com/Ponywen0819/car-record /root/car-record`）。
  - 把 `deploy/.env.example` 複製成 host 上的 `deploy/.env`（`chmod 600`），填入 `DATABASE_URL`（及選填的 `API_TOKEN`）；`APP_TAG` 由 `deploy/deploy.sh` 自動維護。
  - 產生部署專用的無 passphrase `ed25519` 金鑰，將公鑰加進 host 的 `/root/.ssh/authorized_keys`，前綴限制寫成：`command="/root/car-record/deploy/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty`。
  - 在 GitHub repo（或 `production` environment）設定 Actions variable `DEPLOY_HOST`（填 `root@<固定 IP>`，runner 容器解析不到 `.local`）與 secret `DEPLOY_SSH_KEY`（部署私鑰完整內容）。
  - 第一次部署先在 host 手動執行（舊版還沒有 `deploy/deploy.sh`）：`cd /root/car-record && git fetch --tags && git checkout --detach vX.Y.Z && deploy/deploy.sh vX.Y.Z`。

| 環境變數 | 預設值 | 說明 |
|---|---|---|
| `DATABASE_URL` | （必填） | `postgres://user:password@host:5432/car_record`。建議用專屬的資料庫；啟動時會自動建立／升級資料表。連不上時程式直接結束，由容器的重啟策略重試 |
| `PORT` | `8080` | 純 HTTP 連接埠（HTTPS 由外部處理） |
| `DATA_DIR` | `./data`（Docker 裡是 `/data`，掛在 `car-record-data` volume） | 照片存在 `photos/` |
| `STATIC_DIR` | `apps/web/dist` | 前端 build 輸出 |
| `API_TOKEN` | （無） | 設定後 `/api/*` 需要 `Authorization: Bearer <token>`；App 的「設定 → 同步」可以填入 |

**備份**：紀錄在 Postgres（`pg_dump "$DATABASE_URL" > car-record.sql`），照片在 `DATA_DIR`，兩邊都要備份。`/healthz` 會順便檢查資料庫，連不上時回 503。

## CI

`.github/workflows/docker-publish.yml` 全部跑在自架 runner（labels：`self-hosted`、`docker`）上。推到 `develop`、`main` 和 PR 都會跑測試（先用 PGlite 跑全部，再啟動一個暫時的 `postgres:17` 容器，對真正的 Postgres 跑 server 和整合測試）；只有 `main` 和 `v*` tag 會在測試通過後建置 `linux/amd64` 與 `linux/arm64`（raspi 用）的多架構 image 並推到 `ghcr.io/ponywen0819/car-record`，而 `v*` tag 在 image 推送完成後還會自動部署到 host。分支與版本規則見 [CLAUDE.md](CLAUDE.md)。

- runner 容器要能使用 Docker（例如掛載 `/var/run/docker.sock`），才能建置 image
- repo 是公開的：來自 fork 的 PR 不會在自架 runner 上執行

## iPhone 捷徑網址

`/add/fuel`、`/add/maintenance`、`/add/expense`、`/reminders`。可以用「捷徑」App 搭配 Siri 或 NFC 貼紙開啟。
