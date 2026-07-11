# MT-M6 收尾強化 設計文件

- **日期**: 2026-07-11
- **對應 WBS**: 5.9 MT-M6
- **分支**: feat/mt-m6-wrapup

## 背景

MT-M1~M5 已打通「註冊 → 自管服務 → 客戶送單 → 後台終審 → Email 寄達」全鏈。M6 是產品化收尾，四塊獨立子系統，捆成同一里程碑：

1. rate limit 補洞（per-slug 雙桶）
2. env 清理（刪除作廢的 LINE/Gmail 變數）
3. landing 導流到 signup
4. `/dashboard/settings`（商家自行改 profile/slug）

外加：verify scripts 全數過帳（新增覆蓋 + 全量回歸跑一次）。

## A. Rate limit 雙桶

**現況**：`checkRateLimit(bucketKey, rule)`（`src/lib/rateLimit/rateLimit.ts`）已是通用函式，`POST /api/sessions` 只查一次 `sessions:${ip}` bucket。同一 slug 被大量不同 IP（殭屍網路/共用 NAT）灌爆完全沒防護。

**設計**：`POST /api/sessions`（`src/app/api/sessions/route.ts`）改為依序查兩個獨立 bucket，皆用現有 `SESSION_CREATE_RULE`（10 次/小時）：

- `sessions:ip:${ip}`
- `sessions:slug:${slug}`（slug 從已解析的 body 取得，故此檢查移到 `createSessionBodySchema` 解析成功之後、查商家之前）

任一超限即回 429（OR 邏輯，不疊加判斷）。`checkRateLimit` 本身、RPC、migration 皆不需改動——純粹是呼叫端多查一次不同 bucketKey。

**驗證**：`verify-rate-limit.ts` 補一組斷言，證明同 slug 不同 bucketKey 前綴會被獨立計數並在達到 limit 時擋下（模擬「同 slug 多來源灌爆」情境，不需真的用多個 IP，因為 bucket 是純字串鍵）。

## B. Env 清理

**現況**：`src/lib/env.ts` 的 `envSchema` 宣告 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`GMAIL_USER`、`GMAIL_APP_PASSWORD`、`ADMIN_SECRET` 五個 optional 欄位。已用 grep 確認全部零程式碼引用（無 `requireEnv()` 呼叫點）。前四者對應已作廢的 LINE 終審鏈與 Gmail SMTP（4.3-4.8 作廢）；`ADMIN_SECRET` 未曾被任何端點使用，YAGNI 一併刪除。

**設計**：`envSchema` 移除上述五個欄位；`.env.example` 同步移除對應區塊（含相關註解）。純刪除，不影響任何現有功能（已確認零引用即零風險）。

## C. Landing 導 signup

**現況**：`src/app/page.tsx` 是純說明頁（標題、支援類型列表、「已有商家連結」提示），沒有任何連到 `/signup` 或 `/login` 的連結。

**設計**：在 header 區塊下方加入兩個連結：
- 主要 CTA「開始使用」→ `/signup`（沿用 dashboard 頁面既有的按鈕樣式：實心背景、圓角）
- 次要文字連結「已有帳號？登入」→ `/login`

不新增元件庫或抽象，用現有 Tailwind class 手刻，與既有頁面風格一致。

## D. `/dashboard/settings`

**API**：新增 `src/app/api/dashboard/settings/route.ts`：

- `GET`：`requireMerchant()` 守門後回 `{ display_name, public_slug }`。
- `PATCH`：body 為 `{ display_name?: string, public_slug?: string }`（至少一欄）。zod schema 驗證：
  - `display_name`：非空字串（trim 後長度 ≥ 1）
  - `public_slug`：regex 對齊 DB CHECK `^[a-z0-9][a-z0-9-]{2,31}$`
  - 格式錯誤 → 400
  - 呼叫 `merchantsRepository.update(merchantId, patch)`；DB unique_violation（slug 被別人佔用）→ 沿用 `src/app/api/dashboard/services/route.ts` 已有的 `isUniqueViolation()` 判斷慣例 → 409
  - 成功 → 200 回更新後的 `{ display_name, public_slug }`

**Repository**：`merchantsRepository` 已有繼承自 `BaseRepository` 的泛型 `update()`，不需新增方法。

**UI**：新增 `src/app/dashboard/settings/page.tsx` + 表單元件：
- 顯示目前 `display_name`、`public_slug`（含分享連結 `/q/{slug}` 唯讀預覽方便複製）
- Inline 編輯，沿用 `/dashboard/services` 頁面的編輯/送出/錯誤提示模式
- PATCH 回 409 時顯示「此代號已被使用，請換一個」

**路由保護**：沿用 `requireMerchant()`，與其他 dashboard 頁面一致，不新增授權邏輯。

## E. verify scripts 全數過帳

- 新增 `scripts/verify-settings.ts`（真實 DB）：證明三件事——(1) 改名成功後 `merchants` 列真的更新；(2) 兩商家搶同一 slug，後改的一方回 409；(3) 跨租戶（用商家 B 的 merchantId 想改商家 A 的資料——實際上 PATCH 沒有帶 id 參數，只能改自己，此項改為驗證未登入呼叫回 401）
- 更新 `scripts/verify-rate-limit.ts` 覆蓋雙桶行為
- 任務收尾時完整跑一輪現有全部 14 支 `verify:*` 腳本 + `db:verify`，確認本次改動未波及既有功能（env 刪除、rate limit 呼叫端改動都有波及既有端點的風險，需要回歸確認）

## 測試策略

- 單元測試（vitest）：rate limit 呼叫端雙 bucket 邏輯、settings schema 驗證、settings service 的 409/200 分支——沿用專案明確斷言慣例，非快照
- verify scripts：如上，對真實 DB 驗證
- 不新增 E2E（8.2 任務範圍，非本次）

## 不做的事（Out of scope）

- Resend 自有網域 SPF/DKIM（8.4 部署前）
- `REVOKE EXECUTE FROM PUBLIC`（8.3 安全審查）
- 密碼變更、Email 變更（settings 只管 display_name/slug，帳密走 Supabase Auth 既有機制，非本次範圍）
