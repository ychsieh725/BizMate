# MT-M4b：調金額 + 確認（Design Spec）

- **WBS 任務**：5.7
- **日期**：2026-07-11
- **分支**：`feat/mt-m4b-quote-confirm`
- **依賴**：5.6 MT-M4a（quoteReviewService / quoteReviewRepository / 詳情頁）
- **後續**：5.8 MT-M5（Email 寄送）依賴本任務產出的 `confirmed` 狀態

---

## 1. 目標與範圍

商家在後台看完報價後，能調整最終金額並確認送出，讓 session 進入 `confirmed` 狀態，供 5.8 寄信。

**本任務涵蓋**：

- `PATCH /api/dashboard/quotes/{id}` — 調整 `final_amount`（限 `awaiting_review`）
- `POST /api/dashboard/quotes/{id}/confirm` — 確認（`quote_confirmed` 事件落地）
- Migration 0005：兩個原子 RPC
- 詳情頁的操作區（金額輸入 + 確認按鈕，僅 `awaiting_review` 顯示）

**本任務不涵蓋**：

- Email 寄送（5.8）
- 編輯個別費用明細列（YAGNI —— 商家調的是最終總額，不是逐項改價）
- 退回 / 作廢報價（狀態機無此轉移，需要時再設計）

---

## 2. 核心問題：兩個 status 的一致性

### 2.1 事實

`quotes.status`（enum `quote_status`）與 `sessions.status`（enum `session_status`）是**同一份狀態存了兩份**。報價只在 pricing 之後存在，此時 session 狀態只可能是 `awaiting_review` / `confirmed` / `sent` / `abandoned`。

Supabase JS **不提供多語句 transaction**，現有寫入（如 `resolveAfterParse`）都是連續 update。因此「同時推進兩個 status」天生存在不一致窗口。

### 2.2 決策：Postgres RPC 保證原子性

拍板 migration 0005 的兩個 RPC，在**單一 transaction** 內完成跨表寫入。專案已有原子 RPC 先例（0002 的 `increment_rate_limit`）。

否決的方案：
- **應用層順序寫入**：若 session 更新成功、quote 失敗，重按確認會撞上狀態機（`confirmed` 不接受 `quote_confirmed`）而卡死，需要額外的修復分支——用隱性陷阱換「不寫 migration」，不划算。
- **廢掉 `quotes.status` 改讀 session**：資料結構上最乾淨，但要回頭改剛驗收完的 5.6，且 5.8 寫 `sent_at` 時仍得回來面對 quotes 表。

### 2.3 分工原則：RPC 裡不放業務知識

狀態機（`transitions.ts`）必須維持**唯一事實來源**。若把 `awaiting_review → confirmed` 硬編進 SQL，狀態定義就有兩份，必然腐爛。

```
應用層（quoteActionsService）:
  1. quoteReviewRepository.findById → 歸屬檢查（重用 5.6）
  2. 讀 session.status → transition(current, "quote_confirmed")
     非法轉移 → 409
  3. 帶著 from_status / to_status 呼叫 RPC

RPC（confirm_quote）:
  只做原子寫入 + 樂觀鎖（CAS）：
  UPDATE ... WHERE status = p_from_status  ← 條件不成立即 0 列
  任一表更新 0 列 → 整個 transaction 回滾 → 回 false
  應用層收到 false → 409（併發下有人搶先確認）
```

RPC 不知道也不在乎什麼是合法轉移——那是 `transitions.ts` 的事。

---

## 3. 核心問題：調金額後明細對不上總額

### 3.1 事實

目前 `sum(price_line_items.amount) == quotes.final_amount`（`computeBasePricing` 算出明細後加總為 total）。商家把 8,000 改成 9,000 後，等式破裂。

5.8 的報價信會同時列出明細與總額寄給客戶。明細加總 8,000、總額 9,000 —— 客戶會直接問「這 1,000 是什麼」。

### 3.2 決策：以「手動調整」明細列補差額

`adjust_quote_amount` RPC 在單一 transaction 內：

1. 刪除既有的手動調整列（識別條件：`rule_id IS NULL AND modifier_id IS NULL`）
2. 重算剩餘明細加總 `base_sum`
3. `diff = p_new_amount - base_sum`；若 `diff <> 0`，插入一列調整明細（`agent_reasoning` 記錄為商家後台調整）
4. `UPDATE quotes SET final_amount = p_new_amount`

差額由 RPC 自算，應用層不碰。**不變式 `sum(line_items) == final_amount` 由這個函式獨自保證**——這是它存在的理由。重複調整不累積多列（每次先刪再插）。

否決的方案：
- **只改 `final_amount`**：把「解釋差額」的責任推給 UI 與信件模板，且 DB 永遠存著一組對不上的數字。
- **加 `original_amount` 欄位**：多存一個數字，沒解決明細加總對不上總額的問題。

---

## 4. 檔案結構

### 新增

| 檔案 | 職責 |
| :--- | :--- |
| `supabase/migrations/0005_quote_actions.sql` | `confirm_quote` / `adjust_quote_amount` 兩個 RPC + `GRANT EXECUTE` 給 service_role |
| `src/domains/pricing/quoteActionsService.ts` | 歸屬檢查 → 狀態機驗證 → 呼叫 RPC |
| `src/domains/pricing/repositories/quoteActionsRepository.ts` | 封裝兩個 RPC 呼叫（`supabase.rpc()`） |
| `src/domains/pricing/quoteActionsSchemas.ts` | `adjustAmountBodySchema`（`final_amount` 正數） |
| `src/app/api/dashboard/quotes/[id]/confirm/route.ts` | `POST` 確認 |
| `src/app/dashboard/quotes/[id]/QuoteActions.tsx` | client component：金額輸入 + 儲存、確認按鈕 |
| `scripts/verify-quote-actions.ts` | 對真實 DB 驗證原子性與租戶隔離 |

### 修改

- `src/app/api/dashboard/quotes/[id]/route.ts` — 加 `PATCH`（既有 `GET` 不動）
- `src/app/dashboard/quotes/[id]/page.tsx` — 掛上 `QuoteActions`（僅 `awaiting_review` 顯示）
- `src/shared/constants/routes.ts` — 補 `API_ROUTES.dashboardQuoteConfirm(id)`
- `package.json` — 註冊 `verify:quote-actions`

### GRANT（不可遺漏）

0001 的 `GRANT ALL ON ALL TABLES` 只涵蓋當時已存在的物件。新 RPC 必須顯式 `GRANT EXECUTE ON FUNCTION ... TO service_role`，否則呼叫時 permission denied（0002 的註解已記錄此坑）。

---

## 5. API 契約

### `PATCH /api/dashboard/quotes/{id}`

Body：`{ "final_amount": number }`（正數）

| 情況 | 回應 |
| :--- | :--- |
| 未登入 | 401 |
| 已登入無 merchant | 403 |
| `id` 非 UUID／`final_amount` 非正數 | 400 |
| 報價不存在或屬於其他商家 | 404 |
| 報價不在 `awaiting_review`（已確認/已寄出，或併發搶先） | 409 |
| 成功 | 200 `{ quote }`（更新後的報價） |

### `POST /api/dashboard/quotes/{id}/confirm`

無 body。

| 情況 | 回應 |
| :--- | :--- |
| 未登入 / 無 merchant | 401 / 403 |
| `id` 非 UUID | 400 |
| 報價不存在或屬於其他商家 | 404 |
| session 狀態不接受 `quote_confirmed`（非法轉移或併發搶先） | 409 |
| 成功 | 200 `{ quote }`（status 已為 `confirmed`） |

---

## 6. UI

詳情頁在報價摘要下方新增操作區，**僅當 `quote.status === "awaiting_review"` 時顯示**：

- 金額輸入框（預填 `final_amount`）+ 「儲存金額」按鈕 → `PATCH`
- 「確認報價」按鈕 → `POST /confirm`（送出前 `window.confirm` 二次確認，與 5.5 停售按鈕慣例一致）
- 成功後 `router.refresh()` 讓 Server Component 重查
- 錯誤以 `role="alert"` 顯示友善訊息（409 顯示「這張報價已被確認或寄出，請重新整理」）

非 `awaiting_review` 的報價：不顯示操作區（唯讀），狀態標籤已足夠說明。

---

## 7. 測試策略（TDD）

| 層級 | 測試項 |
| :--- | :--- |
| `quoteActionsService` | 跨租戶 → null（route 轉 404）；報價不存在 → null；session 狀態非法（如已 `confirmed`）→ 明確的 conflict 結果；**RPC 回 false → conflict**（併發）；成功路徑傳給 RPC 的參數正確（from/to status 來自狀態機，非硬編碼） |
| `PATCH` route | 401/403/400（非正數金額）/404/409/500 |
| `POST /confirm` route | 401/403/400/404/409/500 |
| `scripts/verify-quote-actions.ts` | **對真實 DB 證明原子性**：① 調金額後 `sum(line_items) == final_amount`（含重複調整不累積調整列）② 確認後 `sessions.status` 與 `quotes.status` 同步為 `confirmed` ③ 重複確認回 false ④ 跨租戶被擋 ⑤ **故意傳錯 `from_status`，證明 0 列更新且不留半套資料（rollback 生效）** |

第 ⑤ 條是驗收核心：原子性不能靠宣稱，要對真實 Postgres 證明。

---

## 8. 風險

| 風險 | 緩解 |
| :--- | :--- |
| Migration 0005 需手動套用至 Supabase（專案慣例），忘了套 → RPC 不存在 | verify script 第一步就呼叫 RPC，未套用會立刻失敗並印出明確訊息 |
| 忘記 `GRANT EXECUTE` → permission denied | migration 內含 GRANT；verify script 以 service_role 實際呼叫驗證 |
| 手動調整列的識別條件（`rule_id IS NULL AND modifier_id IS NULL`）誤刪其他明細 | **已驗證**：`computeBasePricing` 產出的每筆明細必帶 `rule_id` **或** `modifier_id` 其中之一——基礎費項目帶 `ruleId`、`modifierId=null`；加成項目帶 `modifierId`、`ruleId=null`（`basePricing.ts:79-96`）。故「兩者皆 null」唯一標識手動調整列。此前提寫入 RPC 註解；未來若新增兩者皆 null 的明細類型，須改識別條件 |
| `outOfScope` 報價（查無子類型）的 `final_amount` 為 null 且無明細列 | 調金額仍可運作：`base_sum = 0`、`diff = p_new_amount`，插入一整筆調整列。這正是商家為 out-of-scope 案件手動定價的路徑，不是例外 |
