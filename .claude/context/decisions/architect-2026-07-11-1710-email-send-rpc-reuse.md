# 架構決策報告：MT-M5 Email 寄送與 RPC 重用

- **日期**: 2026-07-11 17:10
- **任務**: 5.8 MT-M5 Email 寄送（Resend + 報價信模板）
- **範圍**: `supabase/migrations/0006_rename_advance_status.sql`、`src/lib/email/**`、`src/domains/pricing/quoteActionsService.ts`（`sendQuoteEmail`）、`POST /api/dashboard/quotes/[id]/send`

## 結論

### 1. `confirm_quote` 改名重用為 `advance_quote_status`

5.7 建立的 `confirm_quote` RPC 本質上沒有任何業務邏輯，只是「單一 transaction 內 CAS 同步 `quotes.status` 與 `sessions.status`」。`confirmed → sent`（本任務）面臨與 `awaiting_review → confirmed` 完全相同的雙表原子性問題。

決策：migration 0006 `DROP` 舊名 + `CREATE` 新名 `advance_quote_status`，新增 `p_set_sent_at`（預設 `FALSE`）參數以原子寫入 `sent_at`，不為「寫時間戳」這個小事另開函式。5.7 的 `confirmQuote` 呼叫點同步改名（`setSentAt: false`），5.8 的 `sendQuoteEmail` 呼叫（`setSentAt: true`）。

驗證：改名後重跑 `verify:quote-actions`，八組斷言輸出與改名前完全一致，證明是無行為變更的重構。

### 2. `sendQuoteEmail` 的順序：先寄信、成功才推進狀態

若順序反過來（先推進狀態、再寄信），失敗時會出現「狀態已是 sent 但信根本沒寄出」的假象，商家會誤以為流程已完成。決策：`sendQuoteEmail` 固定順序——歸屬檢查 → 狀態機驗證（`transition(session.status, "email_sent")`）→ 呼叫 Resend → 成功才呼叫 RPC。

**已知邊界（code review 確認並修正註解）**：若 Resend 成功但緊接的 RPC 呼叫拋出例外（非回傳 `false`），信已寄出但狀態仍是 `confirmed`，重試會真的再寄一封。這不是分散式交易，沒有補償機制；取捨是寧可偶爾重寄，也不要讓 `status=sent` 卻信沒寄出。

### 3. 502 vs 500 vs 409 的錯誤語意區分

`POST /send` 明確區分：`not_found` → 404、`email_failed`（Resend API 失敗）→ **502**（外部服務錯誤，非系統忙碌）、`conflict`（狀態不符）→ 409、未預期例外 → 500。讓前端能針對「Email 服務暫時無法使用」顯示不同於「系統忙碌」的文案。

### 4. `merchant === null` 與 `session.contact_email === null` 直接 throw

兩者都是「不可能發生的資料不一致」而非業務錯誤：`merchantId` 來自已認證的 `requireMerchant`；`contact_email` 由 `/describe` API 強制要求。Fail loud（throw）優於回傳一個 `QuoteActionResult` 變體，因為這種情況代表系統本身有 bug，不該用正常的錯誤處理路徑掩蓋。Route 層 catch 這個例外只回「系統忙碌，請稍後再試」，堆疊資訊只進 `console.error`，不外洩給客戶端。

### 5. `renderQuoteEmail` 測試改用明確斷言，不用快照測試

WBS 原文寫「快照測試」，但專案零快照測試慣例（`quoteFormatter.test.ts` 同類型純函式測試皆用 `toContain`/`toBe`）。快照測試容易變成「看到差異就無腦更新」而失去把關意義。

## 行動項目

- [ ] 5.9 MT-M6：`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` 一併處理 `advance_quote_status`（沿用 5.7 記錄的待辦，範圍隨改名擴大）
- [ ] 8.4 部署前：Resend 自有網域 SPF/DKIM（目前用共用測試網域，PRD §14.2 已記錄）
- [ ] 未來若要做「Resend 成功但 RPC 失敗」的補償機制（outbox pattern），需求出現時再設計，目前 MVP 接受 at-least-once

## 影響評估

- **嚴重度**: MEDIUM（外部 API 整合的錯誤語意設計；RPC 重用是防腐蝕重構）
- **影響範圍**: `domains/pricing` 的終審動作模組；5.9 收尾任務
