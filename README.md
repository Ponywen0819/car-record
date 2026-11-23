# 車輛記錄（car-record）

自用的車輛狀況記錄 PWA，以 iPhone 為主要使用平台。完整規格見 [SPEC.md](SPEC.md)。

- **web**（`apps/web`）：React + Ionic（iOS 模式）PWA；手機上的 Dexie 只存快取和待上傳佇列
- **server**（`apps/server`）：Hono + `node:sqlite`，同時提供網頁檔案和同步 API；資料以 server 為準
- **shared**（`packages/shared`）：zod schema、同步協定、保養項目目錄

## 開發

需要 Node 22 和 pnpm。

```bash
pnpm install
pnpm dev:server   # API，http://localhost:8080
pnpm dev:web      # 前端，http://localhost:5173（/api 會轉送到 8080）
```

## 測試

```bash
pnpm test         # 全部：shared、server、web 單元測試 + 真實 server 整合測試
pnpm typecheck
```

`apps/web/integration/` 會讓真正的前端同步引擎直接對真正的 server 程式碼跑測試（離線佇列、衝突、照片、重啟後資料仍在、token 驗證）。

## 正式環境

```bash
pnpm build        # apps/web/dist + apps/server/dist/main.js
pnpm start        # node apps/server/dist/main.js
```

或用 Docker（在 `deploy/` 資料夾裡）：

```bash
docker compose up -d --build
```

| 環境變數 | 預設值 | 說明 |
|---|---|---|
| `PORT` | `8080` | 純 HTTP 連接埠（HTTPS 由外部處理） |
| `DATA_DIR` | `./data`（Docker 裡是 `/data`，掛在 `car-record-data` volume） | `app.db`（SQLite）和 `photos/`，**備份這個資料夾即可** |
| `STATIC_DIR` | `apps/web/dist` | 前端 build 輸出 |
| `API_TOKEN` | （無） | 設定後 `/api/*` 需要 `Authorization: Bearer <token>`；App 的「設定 → 同步」可以填入 |

## CI

`.github/workflows/docker-publish.yml` 全部跑在自架 runner（labels：`self-hosted`、`home`）上。推到 `main` 會先跑測試，通過後建置 `linux/amd64` image 並推到 `ghcr.io/ponywen0819/car-record`。

- runner 容器要能使用 Docker（例如掛載 `/var/run/docker.sock`），才能建置 image
- repo 是公開的：來自 fork 的 PR 不會在自架 runner 上執行

## iPhone 捷徑網址

`/add/fuel`、`/add/maintenance`、`/add/expense`、`/reminders`。可以用「捷徑」App 搭配 Siri 或 NFC 貼紙開啟。
