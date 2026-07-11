# code-quality-specialist 報告

- **日期**: 2026-07-11 13:00
- **任務**: feat/mt-m4b-quote-confirm 分支 code review（8 commits）
- **範圍**: migration 0005 兩個 RPC、`quoteActionsService`、`quoteActionsRepository`、PATCH/POST 兩支 API、`QuoteActions.tsx`

## 結論

**品味評分 🟡 → 修正後可合併。0 CRITICAL。RPC 本身的併發正確性經逐條追查確認無誤。**

Reviewer 實際追過的四個重點：

- **併發正確性無漏洞** — 兩個並發 confirm：T2 的 `UPDATE quotes` 阻塞在 T1 的 row lock，T1 提交後 Postgres 對新版本重跑 WHERE（EvalPlanQual），`status` 已變 → 0 列 → `RETURN FALSE`。只有一個成功。**不需要顯式 `FOR UPDATE`**（`UPDATE` 自己就取 row-level exclusive lock）。兩個 function 都以 quotes 為第一個鎖定對象，鎖順序一致，無死鎖環。
- **`RAISE EXCEPTION` 的回滾語意如預期** — 函式內沒有 `EXCEPTION` 區塊吞掉它，例外會 abort PostgREST 為該次 RPC 開的 transaction，先前的 `UPDATE quotes` 一併回滾。
- **NUMERIC 精度不會破壞不變式** — `base_sum` 由已是 2 位小數的列加總而來，`round(p_new − base_sum) + base_sum ≡ round(p_new)`，兩邊的 round 相互抵銷。
- **RPC 沒有洩漏業務知識** — SQL 裡搜不到任何硬編碼的狀態轉移。

## 已修正的問題

| 嚴重度 | 問題 | 修正 |
| :--- | :--- | :--- |
| HIGH | **驗收腳本的核心宣稱從未被執行到**：斷言全走 service，應用層守衛在 RPC 之前就短路，RPC 的 CAS 與 `WHERE merchant_id` 一次都沒被觸發；spec §7 明列的 rollback 證明整條沒實作 | verify script 新增三組**直接打 RPC** 的斷言，含人為造出不一致狀態證明 `RAISE EXCEPTION` 回滾。已對真實 Postgres 通過 |
| MEDIUM | `adjustQuoteAmount` 缺 session 閘門 → 「quote 已待審、明細未落地」窗口內調金額會破壞不變式 | 補上與 `confirmQuote` 對稱的 session 歸屬 + 狀態閘門 |
| MEDIUM | `final_amount` 無上界 → `NUMERIC(10,2)` 溢位變成 500（實為輸入錯誤，該 400） | schema 加 `.max(99_999_999.99)` |
| MEDIUM | spec §3.2 的步驟順序寫反（`UPDATE quotes` 被放到最後），而該順序正是並發安全的來源 | SQL 與 spec 都補上「承重牆」註解 |
| LOW | `QuoteActions` 的錯誤訊息未綁定輸入框、number input 缺 `min`/`step` | `aria-invalid` + `aria-describedby` + `min`/`step` |

## 行動項目（延後）

- [ ] 8.3：`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC`（防禦縱深；目前不可利用）

## 影響評估

- **嚴重度**: HIGH（HIGH 項目是「驗證假象」——腳本宣稱證明了它其實沒證明的東西）
- **影響範圍**: `domains/pricing` 終審動作
