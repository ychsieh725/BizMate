# code-quality-specialist 報告

- **日期**: 2026-07-11 17:10
- **任務**: feat/mt-m5-email 分支 code review（6c7e960..95e1cf5）
- **範圍**: RPC 改名重用、`renderQuoteEmail`、`sendQuoteEmail`、`POST /send`、`SendQuoteButton.tsx`

## 結論

**品味評分 🟢，PASS 可合併。0 CRITICAL / 0 HIGH / 0 MEDIUM。**

四項最高優先審查點全數驗證通過：

- **RPC 改名無遺漏呼叫點** — grep 全 codebase，`confirm_quote` 只剩 migration 0005（歷史檔）與 0006 的 `DROP IF EXISTS`；`advance_quote_status` 三個呼叫點（`confirmQuote`/`sendQuoteEmail`/`verify-quote-actions.ts`）參數皆正確。
- **Resend/RPC 之間無吞例外** — `callAdvanceQuoteStatus` 遇錯直接 throw，`sendQuoteEmail` 不 catch，傳播到 route 的 catch 回 500；重複寄送在呼叫 Resend 之前就被狀態機（`sent` 是終態）擋下，`verify-email.ts` 實測涵蓋。
- **兩個 throw（merchant/contact_email null）合理** — 真正的資料不變式違反，fail loud 是對的；route 層轉成安全的 500，堆疊不外洩。
- **502/500/409/404 區分正確且有測試覆蓋** — route 四態分明，`route.test.ts` 八案例逐一覆蓋。

其他審查：XSS 防護（`escapeHtml`）無遺漏注入點；`SendQuoteButton` 與 `QuoteActions` 錯誤處理/a11y 模式一致；`verify-email.ts` 清理完整；migration 0006 SQL 原子且冪等。

## 已處理的問題

兩個 LOW，皆為文件精確度問題，已修（commit `bf085bb`）：

- `sendQuoteEmail` 的函式註解「都不留半套狀態」比實際保證的還多——Resend 成功後 RPC throw 的邊界確實會留下半套狀態（信已寄但狀態未推進）。已改寫註解明確點出這個邊界與取捨理由。
- `verify-email.ts` docstring 寫「證明四件事」但只列三項編號，已修正為「三件事」。

## 行動項目（延後）

- [ ] 5.9：`REVOKE EXECUTE FROM PUBLIC` 一併處理改名後的 `advance_quote_status`

## 影響評估

- **嚴重度**: LOW（兩個已修問題皆為文件精確度，無程式碼缺陷）
- **影響範圍**: `domains/pricing` 終審動作模組、`lib/email`
