# 架構決策報告：MT-M6 收尾強化

- **日期**: 2026-07-11 18:17
- **任務**: 5.9 MT-M6（rate limit 雙桶、env 清理、landing 導流、settings 頁）
- **範圍**: `src/app/api/sessions/route.ts`、`src/lib/env.ts`、`src/app/page.tsx`、
  `src/app/api/dashboard/settings/**`、`src/app/dashboard/settings/**`、
  `src/lib/supabase/errors.ts`

## 結論

### 1. Rate limit 雙桶：OR 邏輯，兩桶同規則

IP 桶與 slug 桶各自用現有 `SESSION_CREATE_RULE`（10 次/小時），任一超限即擋。沒有另外為 slug 桶調不同的 limit/window——使用者拍板的決策，日後若發現商家的合法流量真的超過 10 次/小時再回頭調整，避免現在憑空猜數字。真實 DB 驗證（`verify:ratelimit`）證明兩桶彼此獨立計數。

### 2. isUniqueViolation 抽成共用工具（DRY，rule of three）

settings 的 slug 衝突判斷是第三個需要這段邏輯的地方（`resolveAfterParse.ts` 的 quote_code 撞號重試、`services/route.ts` 的 category+subtype 撞號都已各自複製一份）。第三次重複前抽成 `src/lib/supabase/errors.ts`，兩個既有呼叫點同步改為引用共用工具，行為不變（376 測試迴歸確認）。

### 3. Settings 的衝突偵測：不預查、直接 catch DB UNIQUE

沒有在 UPDATE 前先 SELECT 檢查 slug 是否被佔用（read-then-write 有競態窗口）。直接呼叫 `merchantsRepository.update()`，讓 DB 的 UNIQUE 約束當唯一真相，catch unique_violation 轉 409。沿用 5.5 services 模組已建立的慣例。真實 DB 驗證（`verify:settings`）證明商家 B 搶用商家 A 的 slug 會觸發 unique_violation。

### 4. Env 清理範圍擴大到 ADMIN_SECRET（WBS 未點名，使用者拍板一併清除）

WBS 原文只寫「刪 LINE_*/GMAIL_*」，執行前發現 `ADMIN_SECRET` 同樣零引用，詢問使用者後一併清除（YAGNI）。

### 5. verify-settings.ts 執行中發現並修正的 fixture bug

第一次執行 `verify:settings` 時，測試腳本自己的 slug 組裝邏輯（在已接近 32 字元上限的基底 slug 後面再接 `-renamed` 後綴）觸發了 schema 驗證失敗——這是驗證腳本本身的長度算術錯誤，不是 Task 1-10 引入的生產程式碼缺陷。修正為用獨立產生、長度已知安全的新 slug（`vs-renamed-${Date.now()}`），修正後重跑通過。已同步修正計畫文件，避免未來讀者依樣畫葫蘆踩到同一個坑。

## 驗證涵蓋範圍與已知落差

- **全數涵蓋**：tsc、lint、397 個單元測試、16 支 verify:* 腳本（含新增的 `verify:settings`、更新的 `verify:ratelimit`）皆對真實 Supabase/Gemini/Resend 跑過且通過。
- **curl 對真實 dev server 驗證**：landing 頁 CTA 連結正確渲染（`/signup`、`/login`）；`/dashboard/settings` 未登入被 proxy.ts 導向 `/login`（307）；`GET /api/dashboard/settings` 未登入回 401。
- **已知落差**：本環境沒有可用的瀏覽器自動化工具，無法真的登入模擬瀏覽器點擊 SettingsForm 走完「改名→儲存→看到成功訊息→改 slug 撞號→看到 409 錯誤訊息」的互動流程。曾嘗試用手刻 `@supabase/ssr` cookie 格式配 curl 模擬已登入 session，但 cookie 序列化格式未能還原成功，放棄此路徑而非硬湊出一個看似通過但實際沒測到東西的假驗證。這段互動流程的正確性目前僅由 route.test.ts 的 11 個 mock 測試 + verify-settings.ts 的真實 repository 層驗證共同保證，尚未有一次真人（或自動化瀏覽器）點過這個表單。

## 行動項目

- [ ] 建議在合併前由使用者親自用瀏覽器登入 dev 商家，走一次 `/dashboard/settings` 的改名/改 slug/撞號流程，補上這段目前缺失的真人驗證
- [ ] 8.3 安全審查：`REVOKE EXECUTE ON FUNCTION advance_quote_status/adjust_quote_amount/increment_rate_limit FROM PUBLIC`
- [ ] 8.4 部署前：Resend 自有網域 SPF/DKIM
- [ ] 未來若專案常態需要瀏覽器自動化驗證，評估導入 Playwright（對應 8.2 E2E 任務）

## 影響評估

- **嚴重度**: LOW（收尾強化，無新資料模型、無新業務邏輯分支）
- **影響範圍**: 公開報價入口（sessions）限流行為變嚴格；新增 settings 自管功能；不影響任何既有已驗收流程
