# MT-M3：服務項目管理（services CRUD API + UI） — 設計文件

**日期：** 2026-07-10
**對應 WBS：** 5.5 MT-M3
**對應計畫：** `documents/BizMate_多租戶重構計畫_v1.0.md` §3
**依賴：** 5.4 MT-M2c（已完成，併入 main）

## 背景與目標

MT-M2 完成後，商家能登入、onboarding、看到 dashboard 骨架，但價目表仍是 onboarding 時複製的範本值，無法自行調整。本任務讓商家能管理自己的 `rate_card_base`（新增/inline 編輯/刪除），`rate_card_modifiers` 這輪先唯讀（顯示不可編輯）。

WBS 文件「待確認事項」第 3 條在此任務中拍板：**商家刪除服務項目時，既有引用該 `rule_id` 的歷史報價如何顯示——採軟刪除（`is_active` 標記），不做真實 DELETE**。

## 關鍵限制（設計期間發現）

`price_line_items.rule_id UUID REFERENCES rate_card_base(id)` 未指定 `ON DELETE` 子句，Postgres 預設 `NO ACTION`——真實刪除一個已被歷史報價引用過的 `rate_card_base` 列會直接被資料庫擋下（外鍵違反錯誤）。這證實了軟刪除是必要選擇，不只是偏好。

## 範圍邊界

**包含：**
- `migration 0004_rate_card_soft_delete.sql`：`rate_card_base` 加 `is_active BOOLEAN NOT NULL DEFAULT true`
- `GET/POST /api/dashboard/services`、`PATCH/DELETE /api/dashboard/services/[id]`
- `/dashboard/services` 頁面：inline 編輯（`base_price`/`includes`/`unit`）+ 新增表單 + 軟刪除
- `rate_card_modifiers` 唯讀顯示（隨 GET 回傳，供商家檢視現有加成規則，無編輯/新增/刪除 API）
- `basePricing.ts` 既有計價查詢加 `is_active = true` 過濾，確保停售項目不會被拿去計價

**明確不含：**
- `rate_card_modifiers` 的 CRUD（留給未來任務）
- `category`/`subtype` 欄位的編輯（定義 `UNIQUE (merchant_id, category, subtype)` 且被 `rateCardRepository.findBase` 直接引用查詢，改了會影響既有報價可追溯性，本任務不開放）

## 架構

```
supabase/migrations/0004_rate_card_soft_delete.sql
src/domains/pricing/repositories/servicesRepository.ts   新 CRUD repository（區別於既有唯讀 rateCardRepository）
src/domains/pricing/servicesSchemas.ts                    zod 驗證
src/app/api/dashboard/services/route.ts                   GET（base+modifiers）、POST
src/app/api/dashboard/services/[id]/route.ts               PATCH（base_price/includes/unit）、DELETE（軟刪除）
src/app/dashboard/services/page.tsx                        Server Component 外殼
src/app/dashboard/services/ServicesTable.tsx                Client Component：inline 編輯 + 逐列儲存按鈕
src/app/dashboard/services/NewServiceForm.tsx                Client Component：新增表單
```

沿用既有 `requireMerchant` 守門（5.4）、`route+service` 薄分層慣例（`/api/sessions`、`/api/dashboard/onboarding`）。`rateCardRepository`（pricing 用，唯讀）與新的 `servicesRepository`（dashboard CRUD 用）分開，保持各自單一職責，避免一個 repository 混雜「計價查詢」與「後台管理」兩種不同關注點。

## 資料流

### GET /api/dashboard/services
`requireMerchant` → `servicesRepository.findAllByMerchant(merchantId)`（含 `is_active=false` 的列）+ `rateCardRepository`-style 查詢該商家所有 `rate_card_modifiers` → 回傳 `{ items, modifiers }`。

### POST /api/dashboard/services
`requireMerchant` → 驗證 body `{category, subtype, unit, base_price, includes}` → `servicesRepository.create({...body, merchant_id: merchantId})` → UNIQUE 撞號（Postgres 23505）轉 409「此分類已有相同子類型」。

### PATCH /api/dashboard/services/[id]
`requireMerchant` → `servicesRepository.findById(id)` → 找不到或 `merchant_id !== merchantId` → **404**（不回 403，不洩漏資源存在但非本人所有）→ body 只接受 `{base_price?, includes?, unit?}`，其餘欄位一律忽略 → `servicesRepository.update(id, {...})`。

### DELETE /api/dashboard/services/[id]
同 PATCH 的歸屬檢查（`findById` + 比對 `merchant_id` → 404）→ `servicesRepository.update(id, { is_active: false })`（軟刪除，非真實 DELETE）。

### basePricing.ts 影響
`rateCardRepository.findBase` 加 `.eq("is_active", true)`：已停售項目查無結果 → `computeBasePricing` 走既有 `outOfScope` 分支（無需額外改動邏輯，只加一個查詢條件）。

## UI 互動

- 列表逐列顯示 `category`（唯讀）/`subtype`（唯讀）/`unit`（可編輯）/`base_price`（可編輯）/`includes`（可編輯）+ 「儲存」按鈕（點了才送出 PATCH，不做 onBlur 自動存，避免使用者改一半就誤觸發請求）
- 已停售（`is_active=false`）項目顯示「已停售」badge，表單 disabled（不可再編輯，只能檢視）
- 刪除按鈕觸發瀏覽器原生 `confirm()` 二次確認，成功後前端把該列標記為已停售（樂觀更新或重新 fetch 皆可，實作選重新 fetch，簡單可靠）
- 新增表單獨立區塊（category 下拉選單、subtype/unit 文字輸入、base_price 數字輸入、includes 文字輸入）
- `rate_card_modifiers` 唯讀表格顯示在下方，無任何互動元件

## 錯誤處理

- 未登入 → 401；已登入無 merchant → 403（`requireMerchant` 既有行為）
- POST body 驗證失敗 → 400
- POST UNIQUE 撞號 → 409
- PATCH/DELETE 找不到或非本人資源 → 404
- 其餘例外 → 500 通用訊息（同 `/api/sessions`、`/api/dashboard/onboarding` 既有慣例）

## 測試

- `servicesSchemas.ts`：TDD，邊界驗證（`base_price` 需為正數、`subtype`/`unit` 非空等）
- `servicesRepository.ts`：不另開單元測試（同 `rateCardRepository.ts`、`quotesRepository.ts` 既有慣例，行為由 route 測試 mock 驗證 + 手動瀏覽器驗證涵蓋）
- route 層 TDD：401/403/400/409/404 各分支、跨租戶隔離（B 商家 id 取 A 資源 → 404）、軟刪除後回應正確
- `basePricing.test.ts`：既有測試 mock 的是 `rateCardRepository.findBase` 函式本身（非底層 Supabase client），新增的 `.eq("is_active", true)` 查詢條件在 `findBase` 實作內部，不影響任何 mock 呼叫，既有測試無需改動即可全數通過
- UI 依專案慣例不寫 vitest 單元測試，留待手動瀏覽器驗證（建立→編輯→儲存→刪除→確認已停售+不可再編輯的完整回圈）
