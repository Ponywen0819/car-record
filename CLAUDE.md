# CLAUDE.md

車輛記錄 PWA（自用、iPhone 優先）。規格見 [SPEC.md](SPEC.md)，開發與部署方式見 [README.md](README.md)。

## Git flow

### 分支

| 分支 | 用途 | 從哪裡開 | 合併到 |
|---|---|---|---|
| `main` | 正式版本。每個 commit 都對應一個已發布的版本 | — | — |
| `develop` | **主要開發分支**，所有功能先在這裡整合 | `main` | `main`（發布時） |
| `feature/<name>` | 單一功能的實作 | `develop` | `develop` |

- `<name>` 用小寫英文加連字號，例如 `feature/fuel-anomaly-hint`。
- **不要直接 commit 到 `main` 或 `develop`**，一律透過分支合併。
- 開始新功能前，先把 `develop` 更新到最新：
  ```bash
  git switch develop && git pull
  git switch -c feature/<name>
  ```

### 功能開發（feature → develop）

1. 在 `feature/<name>` 上照 TDD 開發（見下方「開發規則」）。
2. 推上 GitHub，開 PR 到 `develop`。PR 會在 self-hosted runner 上跑型別檢查和全部測試。
3. CI 通過後合併（`--no-ff`），然後刪除 feature 分支。

### 發布（develop → main）：一定要打 version tag

**每一次合併到 `main` 都必須打上版本 tag，沒有例外。**

1. 決定版本號，採用 [SemVer](https://semver.org/lang/zh-TW/) 的 `vMAJOR.MINOR.PATCH`：
   - MAJOR：資料格式或同步協定不相容的變更（舊版 App 無法和新版 server 同步）
   - MINOR：新增功能
   - PATCH：修 bug
2. 在 `develop` 上把版本號更新到下面三個 `package.json`，三者必須一致（App 設定頁顯示的版本讀自 `apps/web/package.json`）：
   - `apps/web/package.json`
   - `apps/server/package.json`
   - `packages/shared/package.json`
3. 開 PR：`develop` → `main`，CI 通過後合併（`--no-ff`）。
4. 在 `main` 的合併 commit 上打 **annotated tag**，並推上去：
   ```bash
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
5. CI 會推送 image：合併到 `main` 時推 `ghcr.io/ponywen0819/car-record:latest`，推送 tag 時推 `:X.Y.Z`。

tag 一旦推上去就不要刪除或移動；有問題就發新的 PATCH 版本。

### CI（`.github/workflows/docker-publish.yml`）

- 全部跑在 self-hosted runner（labels：`self-hosted`、`docker`）上。
- 推到 `develop`、`main`，以及 PR：跑型別檢查和全部測試。
- 只有 `main` 和 `v*` tag 會建置並推送 image。
- repo 是公開的：來自 fork 的 PR 不會在 self-hosted runner 上執行。

## 開發規則

- **TDD：先寫測試、確認失敗，再實作。** 測試是首要交付物，不是事後補上。
- 合併前必須通過：
  ```bash
  pnpm typecheck
  pnpm test        # shared、server、web 單元測試 + 真實 server 整合測試
  ```
- 這個 repo 的 commit 作者信箱用 GitHub noreply（`71641392+Ponywen0819@users.noreply.github.com`），不要用個人信箱。
- HTTPS、對外連線和存取控制都在專案外處理；server 只提供純 HTTP。
