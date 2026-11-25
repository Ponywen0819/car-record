# 車輛狀況記錄 App：規格書（自用版）

> 目標：一個以 iPhone 為主要使用平台的個人車輛記錄工具。
> 形式：PWA（漸進式網頁應用），加入主畫面後以全螢幕 App 的形式使用，不需上架 App Store。
> 部署：自家主機上的 HTTP server，同時提供網頁和 API。資料以 server 為準，支援離線操作和自動同步。HTTPS 由外部負責，不在本專案範圍內。

---

## 目錄

1. [設計原則](#1-設計原則)
2. [核心功能](#2-核心功能)
3. [資料模型](#3-資料模型)
4. [技術選型](#4-技術選型)
5. [iPhone 使用體驗規劃](#5-iphone-使用體驗規劃)
6. [iOS PWA 限制與對策](#6-ios-pwa-限制與對策)
7. [開發階段](#7-開發階段)
8. [未來延伸（不在核心範圍）](#8-未來延伸不在核心範圍)

---

## 1. 設計原則

1. **以「日期 + 里程」為核心軸線**：所有紀錄都會掛上這兩個欄位。
2. **里程以手動輸入為準**：不做 GPS 追蹤（準確度、耗電和 iOS 網頁背景限制都難以克服）。系統用歷次紀錄推算「目前預估里程」。
3. **降低輸入摩擦是最高優先**：必填欄位最少化、自動帶入預設值、用手勢取代按鈕和對話框。
4. **里程只能增加**：輸入值小於上次時要提醒，避免打錯。
5. **Server 是唯一的資料來源，但離線也能操作**：手機上只存快取和待上傳的變更，清掉手機資料後隨時可以從 server 重建；備份統一在 server 端處理。

---

## 2. 核心功能

### 2.1 車輛基本資料

| 欄位 | 必填 | 說明 |
|---|:-:|---|
| 名稱／車牌 | ✅ | 顯示用 |
| 品牌、車型、年份 | | |
| 燃料類型 | ✅ | 汽油／柴油／油電／純電，決定後面要顯示哪些欄位 |
| VIN、引擎號碼 | | |
| 購車日期、購車里程、購車價格 | | 用來計算總持有成本 |

支援多台車，但介面以「目前車輛」為主。

### 2.2 保養與維修紀錄（最核心）

| 欄位 | 必填 | 說明 |
|---|:-:|---|
| 日期 | ✅ | 預設為今天 |
| 里程 | ✅ | 預設為預估里程 |
| 類型 | ✅ | 定期保養／故障維修／自行 DIY，預設為定期保養 |
| 項目（可複選） | ✅ | 機油、機油芯、空濾、冷氣濾網、煞車油、變速箱油、水箱水、火星塞、輪胎、電瓶、雨刷…… |
| 保養廠 | | 自動帶入上次的保養廠 |
| 費用 | | 可以只填總額，也可以逐項填 |
| 照片 | | 工單、發票 |
| 備註 | | |

### 2.3 加油／充電紀錄

| 欄位 | 必填 | 說明 |
|---|:-:|---|
| 日期 | ✅ | 預設為今天 |
| 里程 | ✅ | 預設為預估里程 |
| 油量（L）或電量（kWh） | ✅ | |
| 單價、總價 | | 填其中兩個，第三個自動算出 |
| 是否加滿 | ✅ | 預設為是，計算油耗必須用到 |
| 加油站 | | 自動帶入上次的加油站 |

**油耗計算**：用兩次「加滿」之間的里程差 ÷ 這段期間加入的總油量（中間沒加滿的油量也要算進去）。

### 2.4 其他費用紀錄

- 分類：牌照稅、燃料費、保險（強制險／任意險）、停車、過路費、洗車、罰單、貸款、其他
- 欄位：日期、分類、金額、備註
- 可以設成週期性支出，例如保險每年一次，到期前提醒

### 2.5 提醒系統

**保養提醒**：依里程或時間觸發，哪個先到就先提醒。

| 項目（預設值，可自訂） | 里程間隔 | 時間間隔 |
|---|---|---|
| 機油 | 5,000 km | 6 個月 |
| 機油芯 | 10,000 km | 12 個月 |
| 空氣濾網 | 20,000 km | 12 個月 |
| 冷氣濾網 | 10,000 km | 12 個月 |
| 煞車油 | 40,000 km | 24 個月 |
| 輪胎換位 | 10,000 km | — |
| 電瓶檢查 | — | 24 個月 |

- 「上次執行」會自動從保養紀錄抓取
- 顯示「剩餘 X km／X 天」，快到期的排在最前面
- 狀態分為三級：正常、即將到期（剩不到 10%）、已逾期

**證件與費用到期提醒**：保險、定期驗車、駕照、牌照稅和燃料費繳費期。

**里程推估方式**：

```
預估目前里程 = 最近一次輸入的里程 + 平均每日行駛距離 × 經過的天數
平均每日行駛距離 = 最近 N 筆紀錄（例如 90 天內）的里程差 ÷ 天數差
```

- 每次新增加油或保養紀錄時，推估值自動校正
- 里程類的提醒也能換算成「預估到期日」，方便匯出到行事曆

### 2.6 統計與報表

- **油耗**：每次油耗值、趨勢圖。油耗比平均差超過 15% 時提示異常
- **花費**：每月／每年總額，以及各分類比例（油錢、保養、稅費、保險……）
- **每公里成本**：總花費 ÷ 總行駛里程
- **里程**：每月行駛距離

### 2.7 資料保存與同步

- 所有資料以 server 為準，手機上的資料只是快取（詳見 [4.5 離線同步設計](#45-離線同步設計)）
- 離線時照常新增、編輯、刪除，恢復連線後自動同步
- 畫面上顯示同步狀態：已同步／N 筆待上傳／離線
- Server 端備份資料庫和照片
- 保留匯出 JSON／CSV 的功能，方便另外存檔或分析

---

## 3. 資料模型

```
Vehicle（車輛）
 ├── MaintenanceRecord（保養維修）── MaintenanceItem（項目明細）
 ├── FuelRecord（加油充電）
 ├── ExpenseRecord（其他費用）
 └── ReminderRule（提醒規則）
```

```ts
interface BaseRecord {
  id: string;            // UUID
  vehicleId: string;
  date: string;          // ISO 日期 YYYY-MM-DD
  odometer?: number;     // km；費用紀錄可省略
  cost?: number;         // 元
  note?: string;
  photoIds?: string[];   // 照片另外存放（Blob）
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;    // 軟刪除：支援復原，刪除也能同步到其他裝置
  rev?: number;          // server 指派的版本號（同步用，前端不可修改）
}

interface Vehicle {
  id: string;
  name: string;
  plate?: string;
  brand?: string;
  model?: string;
  year?: number;
  fuelType: 'gasoline' | 'diesel' | 'hybrid' | 'ev';
  vin?: string;
  purchaseDate?: string;
  purchaseOdometer?: number;
  purchasePrice?: number;
}

interface MaintenanceRecord extends BaseRecord {
  kind: 'scheduled' | 'repair' | 'diy';
  shop?: string;
  items: { itemKey: string; cost?: number }[];   // itemKey 對應 ReminderRule
}

interface FuelRecord extends BaseRecord {
  amount: number;        // L 或 kWh
  unitPrice?: number;
  isFull: boolean;
  station?: string;
}

interface ExpenseRecord extends BaseRecord {
  category: 'tax' | 'fuel_fee' | 'insurance' | 'parking' | 'toll'
          | 'wash' | 'fine' | 'loan' | 'other';
  recurring?: { everyMonths: number };
}

interface ReminderRule {
  id: string;
  vehicleId: string;
  itemKey: string;       // 例如 'engine_oil'
  label: string;
  everyKm?: number;
  everyMonths?: number;
  enabled: boolean;
}
```

---

## 4. 技術選型

### 4.1 總覽

| 層面 | 選擇 | 理由 |
|---|---|---|
| 形式 | **PWA**（加入主畫面） | 免上架費；iOS 16.4 以後支援推播、App 圖示角標 |
| 語言 | **TypeScript** | 資料模型多，型別能減少錯誤 |
| 框架 | **React + Vite** | 生態系最大，資料最好找 |
| UI 元件 | **Ionic React（iOS 模式）** | 內建 iOS 原生手感的元件：滑動返回、底部彈出面板、清單左右滑動操作、iOS 轉場動畫，不用自己刻手勢 |
| 手機端儲存 | **Dexie.js**（IndexedDB 封裝） | 存放 server 資料的快取和離線待上傳佇列（outbox）；`liveQuery` 讓畫面自動更新 |
| 離線與快取 | **vite-plugin-pwa**（Workbox） | 自動產生 Service Worker 和 manifest |
| 圖表 | **Chart.js**（react-chartjs-2） | 輕量，觸控提示框可用 |
| 日期處理 | **date-fns** | 可以只引入用到的函式 |
| 圖片壓縮 | **browser-image-compression** | 手機照片動輒數 MB，存入前壓到約 200 KB |
| Server | **Node.js + Hono** | 輕量、TypeScript 原生；同一個 server 提供網頁檔案和 API |
| Server 資料庫 | **PostgreSQL**（`pg` 驅動，純 JS） | 使用自家既有的 Postgres，用 `pg_dump` 備份；啟動時自動建立／升級資料表。所有資料表共用一張通用的 `records` 表（JSONB），由 zod 驗證。測試用 PGlite（編譯成 WASM 的 Postgres） |
| 共用型別與驗證 | **zod**（放在 `packages/shared`） | 前端和 server 共用同一份資料定義和驗證規則 |
| 專案結構 | **pnpm workspace（monorepo）** | web、server、shared 放在同一個 repo |
| 部署 | **Docker**（單一容器） | 純 HTTP，HTTPS 由外部處理，詳見 4.4 |

> **替代方案**：如果覺得 Ionic 太重或樣式不好改，可以改用 **Tailwind CSS + Konsta UI**（iOS 風格元件）+ **Framer Motion**（動畫）+ **@use-gesture/react**（手勢）。彈性較高，但手勢要自己處理。

### 4.2 架構

```
┌────────────────────────────────────────────┐
│ iPhone 主畫面（Standalone PWA）              │
│  ┌──────────────────────────────────────┐  │
│  │ React + Ionic UI                     │  │
│  ├──────────────────────────────────────┤  │
│  │ 業務邏輯（油耗、里程推估、提醒計算）     │  │
│  ├──────────────────────────────────────┤  │
│  │ Dexie.js → IndexedDB                 │  │
│  │  ├ 快取（server 資料的副本）            │  │
│  │  └ Outbox（離線時待上傳的變更）         │  │
│  ├──────────────────────────────────────┤  │
│  │ 同步引擎（push／pull）                 │  │
│  └──────────────────────────────────────┘  │
│  Service Worker（離線快取網頁檔案）          │
└────────────────────────────────────────────┘
        ▲                    │
   網頁檔案          /api/sync/push、/api/sync/pull、/api/photos
        │                    ▼
   （HTTPS：外部處理，不在本專案範圍內）
        │                    │
┌────────────────────────────────────────────┐
│ 自家主機：Node.js HTTP server（Docker）      │
│  ├ 提供 build 後的網頁檔案                   │
│  ├ 同步 API                                 │
│  └ /data（掛載的 volume）                    │
│     └ photos/（照片檔案）                    │
└────────────────────────────────────────────┘
        │ DATABASE_URL
┌────────────────────────────────────────────┐
│ 既有的 PostgreSQL（唯一的資料來源）           │
└────────────────────────────────────────────┘
```

- **Server 是唯一的資料來源**：手機上的資料隨時可以清掉，再從 server 重建
- 備份：Postgres 用 `pg_dump`，照片備份 `/data` volume
- 之後的推播、油價中繼也加在同一個 server 上

### 4.3 專案結構（建議）

```
apps/
├── web/                     # PWA 前端
│   └── src/
│       ├── db/              # Dexie schema：快取 + outbox
│       ├── sync/            # 同步引擎（push／pull、觸發時機、狀態）
│       ├── domain/          # 純邏輯：油耗、里程推估、提醒計算（方便寫單元測試）
│       ├── features/
│       │   ├── dashboard/
│       │   ├── fuel/
│       │   ├── maintenance/
│       │   ├── expense/
│       │   ├── reminders/
│       │   ├── stats/
│       │   └── settings/    # 車輛管理、匯出
│       ├── components/      # 共用元件（里程輸入、項目選擇器、同步狀態……）
│       └── hooks/
└── server/                  # Node.js HTTP server
    └── src/
        ├── database.ts      # Postgres 連線（pg pool）
        ├── store.ts         # 儲存層、migration
        ├── testing/         # 測試用資料庫（PGlite 或 TEST_DATABASE_URL）
        ├── routes/          # sync、photos、healthz
        └── index.ts         # 提供網頁檔案 + API
packages/
└── shared/                  # 共用型別、zod schema、同步協定定義
deploy/
├── Dockerfile
└── docker-compose.yml
```

### 4.4 部署：HTTP server

**範圍**：本專案只負責「一個 HTTP server」，同時提供網頁檔案和 API。HTTPS 和對外連線都由外部處理。

```
deploy/
├── Dockerfile          # 多階段：建置 web + server → 單一 Node 執行映像
└── docker-compose.yml  # 對應連接埠、掛載 /data
```

| 項目 | 規格 |
|---|---|
| 協定 | 純 HTTP |
| 連接埠 | 可設定，預設 `8080` |
| 內容 | 前端 `dist/`（靜態檔案）+ `/api/*`（API） |
| 資料 | 紀錄在既有的 PostgreSQL（`DATABASE_URL`）；照片在 `/data` volume 的 `photos/` |
| 設定 | 環境變數：`DATABASE_URL`（必填）、`PORT`、`DATA_DIR`、`API_TOKEN`（選用） |
| SPA 路由 | 找不到的路徑一律回傳 `index.html`，讓 `/add/fuel` 這類網址可以直接開啟 |
| 快取 | `sw.js`、`index.html`、`manifest.webmanifest` 設 `no-cache`，確保更新能生效；帶 hash 的資源檔設長期快取 |
| 壓縮 | 開啟 gzip（Hono compress middleware） |
| 健康檢查 | `GET /healthz` 回傳 200；資料庫連不上時回 503 |

> 注意：Service Worker 和加入主畫面的離線功能需要 HTTPS 才會生效。純 HTTP 直連時 App 一樣能用，只是沒有離線功能。

### 4.5 離線同步設計

**原則**：server 是唯一的資料來源；手機端只有「快取 + 待上傳佇列（outbox）」。
寫入一律先寫本機，畫面立即更新，再在背景同步（樂觀更新），使用者不用等網路。

**資料流**

```
使用者操作
   │
   ▼
寫入 Dexie 快取（畫面立即更新）+ 加入 outbox
   │
   ▼  有網路時
POST /api/sync/push                → server 套用變更，指派新的 rev
GET  /api/sync/pull?since=<cursor> → 取回其他裝置的變更，更新快取
```

**關鍵規則**

| 項目 | 做法 |
|---|---|
| ID | 前端產生 **UUID v7**：離線新增不需要 server 配號，而且依時間排序 |
| 版本號 | server 每套用一筆變更，就從全域遞增序號指派 `rev`；pull 時以 `rev > cursor` 取得增量 |
| 刪除 | 軟刪除（`deletedAt`）。刪除也是一筆變更，才能同步到其他裝置 |
| 重送安全（冪等） | 每筆 outbox 變更都有 `mutationId`；server 記錄已處理過的 id，重送不會重複套用 |
| 衝突處理 | 自用、裝置少，採**最後寫入者勝（LWW）**，以 server 收到的順序為準。被覆蓋的舊版本寫入 `record_history` 表，必要時可以找回 |
| 推送順序 | outbox 依建立順序送出；同一批在一個交易內套用 |
| 照片 | 另外上傳到 `PUT /api/photos/:id`。上傳完成前手機保留壓縮檔；完成後清掉本機檔案，需要時再從 server 讀取（由 Service Worker 快取） |
| 失敗重試 | 指數退避（1s → 2s → 4s … 最多 5 分鐘）；4xx 錯誤標記為失敗並顯示，不無限重試 |

**同步時機**（iOS 不支援 Background Sync API，只能在 App 開著時同步）

- App 開啟，或從背景切回前景（`visibilitychange`）
- 網路恢復（`online` 事件）
- 每次寫入後（防抖 2 秒）
- App 開著時每 5 分鐘一次

**API**

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/sync/push` | `{ mutations: [{ mutationId, table, record }] }`，一律是整筆覆寫（刪除就是帶 `deletedAt` 的覆寫）→ 回傳每筆的結果（applied／duplicate／rejected）和新的 `rev` |
| GET | `/api/sync/pull?since=<rev>&limit=500` | 回傳 `{ changes: [...], cursor, hasMore }` |
| PUT | `/api/photos/:id` | 上傳照片 |
| GET | `/api/photos/:id` | 取得照片 |
| GET | `/healthz` | 健康檢查 |

**其他**

- **第一次使用或換手機**：沒有 cursor 時從 `since=0` 全量拉取
- **同步狀態 UI**：首頁顯示「✓ 已同步」「↑ 3 筆待上傳」「離線」；同步失敗不打斷操作，只顯示狀態
- **身分驗證**：先交給外部處理；API 預留 `Authorization: Bearer <API_TOKEN>` 檢查，設定環境變數後才啟用
- **為什麼不用現成的同步方案**（RxDB、PowerSync 等）：資料量小、單一使用者，自己實作 push／pull 約幾百行就夠，完全掌握，也不綁定特定服務

---

## 5. iPhone 使用體驗規劃

核心目標：**記一筆加油紀錄要在 10 秒內完成，單手、拇指就能操作。**

### 5.1 版面配置：拇指優先

```
┌─────────────────────────┐
│  （狀態列／瀏海安全區）     │
│                         │  ← 上方只放資訊，不放常用按鈕
│   預估里程 52,340 km      │
│   ┌───────────────────┐ │
│   │ ⚠ 機油 剩 320 km    │ │  ← 提醒卡片
│   └───────────────────┘ │
│   最近油耗 14.2 km/L      │
│                         │
│                         │
│  ─────────────────────  │
│  🏠   📋   ➕   📊   ⚙️   │  ← 底部分頁列，主要操作都在拇指範圍內
│  （Home Indicator 安全區）│
└─────────────────────────┘
```

- 底部分頁列：**首頁／紀錄／➕新增／統計／設定**
- 主要按鈕（儲存、新增）一律放在下半部
- 用 `env(safe-area-inset-*)` 處理瀏海和 Home Indicator

### 5.2 手勢對照表

| 位置 | 手勢 | 動作 |
|---|---|---|
| ➕ 按鈕 | 點一下 | 彈出選單：加油／保養／費用 |
| ➕ 按鈕 | **長按** | 直接開啟「加油」表單（最常用） |
| 新增表單（底部面板） | **往下拖** | 關閉；有未儲存內容時先確認 |
| 新增表單 | 往上拖 | 展開為全螢幕，顯示進階欄位 |
| 紀錄清單項目 | **往左滑** | 刪除（不跳確認框，改用「復原」提示） |
| 紀錄清單項目 | **往右滑** | 複製成新的一筆（日期和里程換成今天的預設值） |
| 紀錄清單項目 | 長按 | 選單：編輯／複製／刪除 |
| 首頁提醒卡片 | **往右滑** | 標記完成，並開啟已預填該項目的保養表單 |
| 首頁提醒卡片 | 往左滑 | 延後提醒（例如 +500 km 或 +7 天） |
| 首頁車輛卡片 | 左右滑 | 切換車輛（多台車時） |
| 統計圖表 | 左右滑 | 切換期間（月／年） |
| 統計圖表 | 點或拖曳 | 顯示該點數值 |
| 子頁面 | 從左緣右滑 | 返回上一頁（Ionic 內建） |

**原則**：
- 所有手勢都有對應的按鈕或長按選單作為備援，避免功能藏起來找不到
- 刪除一律用「**復原（Undo）**」取代確認對話框：少一次點擊，誤刪也救得回來
- 避免從螢幕最底部開始的手勢，以免和 iOS 回主畫面的手勢衝突

### 5.3 表單輸入優化

| 技巧 | 實作方式 |
|---|---|
| 里程預填 | 預填「預估里程」並全選，通常只要改後幾位數 |
| 數字鍵盤 | `<input type="text" inputmode="decimal">`（比 `type="number"` 好用） |
| 防止自動放大 | 輸入框字級 ≥ 16px，否則 iOS 聚焦時會自動放大畫面 |
| 自動計算 | 加油時輸入「總價 + 油量」，單價自動算出（三個值填任兩個即可） |
| 記住上次 | 加油站、保養廠、付款習慣自動帶入 |
| 快速選項 | 保養項目用標籤（chip）複選，**即將到期的項目預先勾選** |
| 日期 | 預設為今天，點一下才展開 iOS 原生日期選擇器 |
| 鍵盤遮擋 | 用 `visualViewport` API 讓儲存按鈕浮在鍵盤上方 |
| 鍵盤送出 | `enterkeyhint="next"` 跳到下一欄，最後一欄用 `"done"` 直接儲存 |
| 拍照 | `<input type="file" accept="image/*" capture="environment">` 直接開相機 |

### 5.4 iOS 系統整合：「捷徑」App

PWA 不能用 manifest 的 shortcuts，但可以透過 **網址參數 + iOS「捷徑」App** 達到類似效果：

| 入口 | 設定方式 | 效果 |
|---|---|---|
| Siri 語音 | 建立捷徑「記加油」→ 打開網址 `https://<你的網域>/add/fuel` | 「嘿 Siri，記加油」直接開啟加油表單 |
| **NFC 貼紙** | 在車上貼一張 NFC 貼紙（約 NT$10），捷徑自動化設定「感應 NFC → 打開網址」 | 手機碰一下貼紙就開始記錄。這是成本最低的「硬體搭配」 |
| 連上車用藍牙或 CarPlay | 捷徑自動化「連線時 → 顯示通知」 | 提醒自己要不要記里程（選用，避免太煩） |
| 主畫面小工具 | 把捷徑加到主畫面或鎖定畫面 | 一鍵開啟特定表單 |

App 需要支援的網址路由：`/add/fuel`、`/add/maintenance`、`/add/expense`、`/reminders`。

### 5.5 視覺與回饋

- 跟隨系統深色模式（`prefers-color-scheme`）
- 關閉回彈捲動干擾：`overscroll-behavior: none`
- 消除點擊延遲：`touch-action: manipulation`
- 按壓狀態要有視覺回饋，例如縮放到 0.97 倍
- **iOS 網頁不支援震動 API（Vibration API）**，所以改用動畫和顏色變化作為操作回饋
- 儲存成功時用輕量的 toast 提示，不打斷流程

---

## 6. iOS PWA 限制與對策

| 限制 | 影響 | 對策 |
|---|---|---|
| 不能排程本機通知 | 提醒無法在 App 關閉時跳出 | **第一階段**：開啟 App 時在首頁顯示，並用 App 圖示角標（Badging API）標示待辦數量。**替代方案**：把提醒匯出成 `.ics` 加入 iOS 行事曆，由行事曆負責通知。**第三階段**：Web Push 加上小型後端排程 |
| Web Push 需要後端 | 要有伺服器負責發送推播 | 之後在 server 上加排程服務（資料已經在 server 上，可以直接計算提醒） |
| 儲存空間可能被清除 | 只有**還沒上傳**的變更有遺失風險，其他資料都在 server 上 | 每次寫入後盡快同步；呼叫 `navigator.storage.persist()` 申請持久化；畫面顯示待上傳筆數 |
| 無背景執行（不支援 Background Sync） | 不能在背景追蹤 GPS；App 關閉時也無法同步 | 里程改用推估；同步只在 App 開著時進行（見 4.5 的同步時機） |
| 不支援震動 | 沒有觸覺回饋 | 用視覺回饋代替 |
| 不支援 manifest shortcuts／share target | 不能長按 App 圖示出現選單，也不能從其他 App 分享進來 | 用「捷徑」App 加網址路由代替 |
| 返回手勢支援不一致 | Standalone 模式下的系統返回手勢不可靠 | 由 Ionic 路由自行處理從左緣滑動返回 |
| 照片佔空間 | 大量照片讓 IndexedDB 越來越大 | 存入前先壓縮；上傳到 server 後清掉手機上的檔案 |

> ⚠️ `.ics` 下載在 Standalone 模式下的行為要實際在 iPhone 上測試。如果無法直接加入行事曆，就改用分享面板匯出。

---

## 7. 開發階段

### 第一階段：MVP（可以開始日常使用）

- [x] 專案建置：monorepo（web + server + shared）
- [x] 前端：Vite + React + TS + Ionic + Dexie + vite-plugin-pwa
- [x] Server：Hono + PostgreSQL，提供網頁檔案和 API（Docker）
- [x] 同步引擎：outbox、push／pull、同步狀態顯示
- [ ] 部署到自家主機，在 iPhone 上加入主畫面測試（Docker 與實機尚未驗證）
- [x] 車輛資料（單台）
- [x] 加油紀錄 + 油耗計算
- [x] 保養紀錄 + 預設保養項目
- [x] 里程推估
- [x] 提醒規則 + 首頁提醒卡片
- [x] 紀錄清單（左滑刪除＋復原、右滑複製）
- [x] JSON 匯出和匯入

### 第二階段：完整體驗

- [x] 其他費用紀錄（含週期性支出）
- [x] 統計圖表（油耗趨勢、花費分布、每公里成本）
- [x] 證件和費用到期提醒
- [x] 照片附件（壓縮後上傳 server）
- [x] 網址路由 + 「捷徑」App 和 NFC 整合
- [x] 提醒匯出到行事曆（.ics）
- [x] App 圖示角標
- [x] 多台車切換

### 第三階段：選用

- [ ] Server 端定期備份（pg_dump + 照片）
- [ ] Web Push 推播提醒
- [x] CSV 匯出

---

## 8. 未來延伸（不在核心範圍）

- **硬體自動取得里程**：例如藍牙 OBD-II。但 iOS Safari 不支援 Web Bluetooth，要另外做中介（例如 ESP32 透過 Wi-Fi 上傳到後端）
- **OCR 辨識**：拍發票或工單自動填入，可以考慮串接多模態 LLM API
- **匯出 PDF 保養履歷**（賣車時用）
- **耗材壽命追蹤**：輪胎胎紋、煞車來令片厚度
