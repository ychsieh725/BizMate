# MT-M5：Email 寄送（Design Spec）

- **WBS 任務**：5.8
- **日期**：2026-07-11
- **分支**：`feat/mt-m5-email`
- **依賴**：5.7 MT-M4b（`quoteActionsService`、原子 RPC、`sum(line_items)==final_amount` 不變式）
- **後續**：5.9 MT-M6（env 清理 `LINE_*`/`GMAIL_*`、rate limit 強化、settings 頁）

---

## 1. 目標與範圍

商家在後台確認報價後，能一鍵將最終報價單以 Email 寄給客戶，讓 session/quote 進入終態 `sent`。

**本任務涵蓋**：

- `POST /api/dashboard/quotes/{id}/send` — 寄送最終報價單
- `renderQuoteEmail` 純函式（HTML + 純文字雙版本）
- `advance_quote_status` RPC（`confirm_quote` 改名而來，供 5.7 的 confirm 與本任務的 send 共用）
- 詳情頁新增「寄送」按鈕（僅 `confirmed` 狀態顯示）

**本任務不涵蓋**：

- 分散式交易補償（outbox pattern）——email 送出成功但 RPC 失敗的極小機率窗口，MVP 階段接受，見 §7 風險
- PDF 附件（`quotes.pdf_url` 欄位保留但不在本任務填入）
- Email 樣板的視覺化編輯——固定模板，非 per-merchant 客製

---

## 2. 核心決策：RPC 改名重用，而非新建

### 2.1 事實

`confirm_quote(quote_id, merchant_id, from_status, to_status)`（5.7 建立）本質上是通用的「CAS 同步更新 `quotes.status` 與 `sessions.status` 兩表」，SQL 內沒有任何業務邏輯——`awaiting_review`/`confirmed` 只是呼叫時傳入的參數字串。

`confirmed → sent` 面臨與 `awaiting_review → confirmed` 完全相同的問題：兩個 status 欄位、Supabase JS 無 transaction、必須原子推進。

### 2.2 決策

Migration 0006：`DROP FUNCTION confirm_quote` + `CREATE FUNCTION advance_quote_status`（簽章不變，僅改名），並擴充寫入 `sent_at`（見 §3）。應用層兩處呼叫點（5.7 的 confirm、本任務的 send）都改叫新名。

否決「保留舊名、新建近乎相同的 `mark_quote_sent`」——那會有兩份幾乎相同的 SQL，未來若 CAS 邏輯要調整（例如加鎖策略變化），得同步改兩處，違反 `coding-style.md` 的 DRY 原則。函式改名讓抽象誠實反映它的通用性。

---

## 3. `advance_quote_status` 的 `sent_at` 擴充

`confirm_quote` 原本只更新 `status` 欄位。`sent` 狀態需要額外寫入 `quotes.sent_at = now()`。RPC 簽章新增一個布林參數控制是否寫入時間戳，而非為「寄送」另開一個函式：

```
advance_quote_status(p_quote_id, p_merchant_id, p_from_status, p_to_status, p_set_sent_at DEFAULT FALSE)
```

`p_set_sent_at = TRUE` 時，`UPDATE quotes` 同時設定 `sent_at = now()`。5.7 的 confirm 呼叫維持 `p_set_sent_at` 預設值 `FALSE`（不動既有呼叫點的參數列表以外的行為）。

---

## 4. 資料流

```
sendQuoteEmail(quoteId, merchantId):
  1. detail = quoteReviewService.getQuoteDetail(quoteId, merchantId)
     → null 就是 not_found（重用 5.6 已驗證過的歸屬檢查，不重造輪子）
  2. detail.quote.status !== "confirmed" → conflict
     （只有 confirmed 能寄；重複呼叫本 API 即為「重寄」機制，見 §5）
  3. merchant = merchantsRepository.findById(merchantId)
     → 理論上不可能 null（歸屬檢查已通過）；null 視為系統錯誤，拋出
  4. { subject, html, text } = renderQuoteEmail({ merchant, quote: detail.quote,
                                                    session: detail.session,
                                                    lineItems: detail.lineItems })
  5. 呼叫 Resend：to = session.contact_email、reply_to = merchant.contact_email
     失敗 → 回傳 email_failed（quote 狀態留在 confirmed，商家可重新按「寄送」重試）
  6. 寄送成功 → 呼叫 advance_quote_status（from=confirmed, to=sent, set_sent_at=true）
     RPC 回 false（罕見的併發或狀態不符）→ 視為系統錯誤（見 §7 風險）
```

租戶隔離複用 `quoteReviewService.getQuoteDetail` 既有的兩層歸屬檢查（quote.merchant_id + session.merchant_id 複查），不新增第三套檢查邏輯。

---

## 5. API 契約

### `POST /api/dashboard/quotes/{id}/send`

無 body。

| 情況 | 回應 |
| :--- | :--- |
| 未登入 / 無 merchant | 401 / 403 |
| `id` 非 UUID | 400 |
| 報價不存在或屬於其他商家 | 404 |
| 報價不在 `confirmed`（尚未確認，或已寄出） | 409 |
| Resend API 呼叫失敗 | **502**（外部服務錯誤，非系統忙碌——與 500 區分，讓前端可顯示「Email 服務暫時無法使用，請稍後重試」而非通用錯誤） |
| 成功 | 200 `{ quote }`（status 已為 `sent`，`sent_at` 已寫入） |

**重寄語意**：本 API 天然冪等地允許在 `confirmed` 狀態下重複呼叫——同一支端點即是重寄機制，不需要獨立的 `/resend` 端點。

---

## 6. Email 內容設計

- **收件者**：`session.contact_email`（客戶在 Step 2 留下的信箱）
- **寄件者**：`EMAIL_FROM`（Resend 平台網域，MVP 階段用共用網域；自有網域 SPF/DKIM 留待部署前決定，PRD §14.2 已記錄）
- **Reply-To**：`merchant.contact_email`（客戶回信直達商家，不經過系統）
- **主旨**：`您的報價單已送達（{quote_code}）`
- **內文結構**（HTML + 純文字雙版本）：
  1. 商家名稱（`merchant.display_name`）
  2. 逐項明細（`item_name` + `amount`，來自 `price_line_items`）
  3. 總計（`final_amount`）——依 5.7 建立的不變式，明細加總恆等於此數字，模板不需處理對不上的情況
  4. `is_conservative === true` 時顯示保守估算提示；`false` 時不顯示
  5. 頁尾：如需調整請直接回信（呼應 reply-to 設計）

---

## 7. 測試策略（TDD）

| 層級 | 測試項 |
| :--- | :--- |
| `renderQuoteEmail` | **明確斷言，非快照測試**（沿用 `formatQuotePreview` 既有慣例，見 §8 決策）：subject 含 quote_code；html/text 含商家名、每筆明細品項與金額、總計；`is_conservative` 為 true/false 時提示文字的有無；reply_to 正確帶入 |
| `sendQuoteEmail`（service） | 跨租戶 → not_found，且不呼叫 Resend（沿用 5.6/5.7 慣例）；非 `confirmed` 狀態 → conflict，且不呼叫 Resend；Resend 失敗 → `email_failed`，且不呼叫 RPC（狀態留 confirmed）；成功 → RPC 呼叫參數正確（`from_status=confirmed, to_status=sent, set_sent_at=true`） |
| `POST /send` route | 401/403/400/404/409/502/200 全覆蓋 |
| `scripts/verify-email.ts` | 對**真實 DB + 真實 Resend API**：建商家+報價 → 推進至 confirmed → 呼叫 send → 驗證 `quotes.status`/`sessions.status` 同步為 sent、`sent_at` 已寫入 → 重複呼叫回 conflict（已是 sent） |

---

## 8. 決策：明確斷言而非快照測試

WBS 原文寫「`renderQuoteEmail` 純函式（快照測試）」，但專案目前零快照測試慣例——`quoteFormatter.test.ts`（同樣是「輸入 → deterministic 字串輸出」的純函式）全部用 `toContain`/`toBe` 明確斷言。

快照測試的弱點：模板改一個字，測試就跟著改，容易變成「看到差異就無腦更新快照」，失去測試的把關意義。決策：比照 `formatQuotePreview` 的既有慣例，用明確斷言。

---

## 9. 檔案結構

### 新增

| 檔案 | 職責 |
| :--- | :--- |
| `src/lib/email/resendClient.ts` | Resend client 單例（比照 `getGeminiClient`，用 `requireEnv` 延遲要求 `RESEND_API_KEY`） |
| `src/lib/email/renderQuoteEmail.ts` | 純函式：`{ merchant, quote, session, lineItems } → { subject, html, text }` |
| `src/app/api/dashboard/quotes/[id]/send/route.ts` | `POST` 寄送 |
| `scripts/verify-email.ts` | 對真實 DB + 真實 Resend API 驗證 |

### 修改

| 檔案 | 異動 |
| :--- | :--- |
| `supabase/migrations/0006_rename_advance_status.sql` | `confirm_quote` 改名 `advance_quote_status`，新增 `p_set_sent_at` 參數 |
| `src/lib/supabase/database.types.ts` | `Functions` 區塊改名 + 新參數 |
| `src/domains/pricing/repositories/quoteActionsRepository.ts` | `callConfirmQuote` → `callAdvanceQuoteStatus` |
| `src/domains/pricing/quoteActionsService.ts` | `confirmQuote` 改呼叫新名；新增 `sendQuoteEmail()` |
| `src/domains/pricing/quoteActionsSchemas.ts` | 新增 `QuoteActionResult` 的 `email_failed` reason（或擴充既有型別） |
| `src/app/dashboard/quotes/[id]/QuoteActions.tsx` | 新增「寄送」按鈕，僅 `confirmed` 狀態顯示 |
| `src/lib/env.ts` | 新增 `RESEND_API_KEY` / `EMAIL_FROM`（optional，比照 `GEMINI_API_KEY` 模式） |
| `.env.example` | 補上兩個新變數 |
| `package.json` | 新增 `resend` 官方 SDK 依賴；`verify:email` script |

---

## 10. 風險

| 風險 | 緩解 |
| :--- | :--- |
| Email 送出成功但 RPC 失敗（罕見）→ quote 停在 confirmed，商家可能重複按送出 → 客戶收到重複信 | MVP 階段接受（at-least-once，非 exactly-once）。真正的補償機制（outbox pattern）成本遠高於這個窗口出現的機率，非本任務範圍 |
| Migration 0006 改名/擴充參數，需手動套用至 Supabase | 沿用 5.7 的驗證流程：verify script 第一步就呼叫 RPC，未套用會立刻失敗並印出明確訊息 |
| Resend 免費層 100 封/日，共用網域寄信可能進垃圾桶 | MVP 階段接受；SPF/DKIM 與自有網域留待部署前決定（PRD §14.2） |
| 手動改名 RPC 若忘記同步 `database.types.ts` 的 `Functions` 型別 | `tsc --noEmit` 會立即報錯（呼叫端的 `.rpc("advance_quote_status", ...)` 型別對不上） |
