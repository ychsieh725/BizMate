# 架構決策報告：MT-M4a 報價審核的租戶隔離

- **日期**: 2026-07-11 12:15
- **任務**: 5.6 MT-M4a 報價列表 + 詳情（唯讀）的資料流與租戶隔離設計
- **範圍**: `src/domains/pricing/quoteReviewService.ts`、`quoteReviewRepository.ts`、`src/app/api/dashboard/quotes/**`、`src/app/dashboard/quotes/**`

## 結論

### 1. 安全不變式：子表查詢只接受經 quote 歸屬檢查後帶出的 session_id

`price_line_items` / `extracted_fields` / `clarification_turns` / `raw_inputs` 四張表**只有 session_id、沒有 merchant_id**（0001_init.sql 的多租戶原則：經 session 間接歸屬，不冗餘加欄位）。而 repository 走 Supabase service_role client，**繞過 RLS**。

因此租戶隔離的保證完全落在應用層。`quoteReviewService` 是這個不變式的**唯一守門處**：歸屬檢查（`quote.merchant_id !== merchantId` → return null）必須在任何子表查詢之前完成，子表方法絕不接受外部傳入的 session_id。

驗證方式：service 單元測試斷言「跨租戶時四張子表 mock 零呼叫」；code review 已 grep 全 codebase 確認四個子表方法的唯一非測試呼叫端就是 `quoteReviewService`。

### 2. quotes 的兩個 FK 是獨立的 — session 歸屬必須複查

`quotes.session_id` 與 `quotes.merchant_id` 在 DB 是兩個**互不相關**的 FK，沒有 composite FK 或 CHECK 保證「該 session 屬於該 merchant」。真正維繫這個等式的是 `resolveAfterParse.ts` 的 insert —— 一個位於**另一個模組**的約定。

決策：在 `getQuoteDetail` 補上 `session.merchant_id !== merchantId → null` 複查，讓不變式由本模組自證，而非依賴跨模組約定。現況不可利用，但任何未來新增的 quotes 寫入路徑一旦錯配，這裡就會把別人的資料整包吐出去。

### 3. 不用 PostgREST embedding join

專案的 `database.types.ts` 是**手寫**的且 `Relationships: []`，用 `.select("*, sessions(...)")` 會讓 supabase-js 的型別推導失效。改為「查 quotes → 用 session_id 批次查 sessions → 在 service 記憶體內組合」，型別安全且 repository 保持單純。

### 4. 詳情頁不 join 服務項目現價

`price_line_items.rule_id` 可能指向已軟刪除（`is_active=false`）的服務項目。**報價是歷史快照**，顯示當下算出的 `amount` 才正確；join 現價會讓商家誤以為既有報價金額變了。

### 5. repository 不寫單元測試（維持專案慣例，已對 review 意見反駁）

Code review 指出：刪掉 `findByMerchant` 的 `.eq("merchant_id", merchantId)`，單元測試不會紅。此為事實，但補該測試需 mock `from().select().eq().eq().order()` chainable builder，驗的是「我有沒有呼叫 .eq」——實作耦合測試，跟著查詢寫法一起壞，卻抓不到真正的隔離失效（RLS policy 寫錯、欄位名打錯）。專案 5 個 repository 全數無單元測試，一致理由相同。

真正的守門員是 `verify:quotes` 對真實雙商家 DB 的驗證。**真實缺口是「它不在 CI」** —— 已記入 WBS 8.4（部署任務）。

## 行動項目

- [ ] 5.7 MT-M4b 動 quotes 時，維持「子表只經 quoteReviewService 存取」這條線
- [ ] 8.4 部署：把 `verify:*` scripts 接進 CI（租戶隔離目前只由手動腳本守門）
- [ ] 5.9 收尾：抽共用的「未授權」區塊元件（目前 4 個 dashboard 頁面各自重複）
- [ ] 5.9 或之後：報價列表分頁（現況無 limit，報價會單調累積）

## 影響評估

- **嚴重度**: HIGH（租戶隔離是多租戶 SaaS 的核心安全屬性）
- **影響範圍**: `domains/pricing` 的 quote review 模組；5.7/5.8 將直接建立其上
