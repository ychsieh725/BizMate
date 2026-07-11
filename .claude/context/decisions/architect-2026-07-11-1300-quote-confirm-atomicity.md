# 架構決策報告：MT-M4b 終審動作的原子性

- **日期**: 2026-07-11 13:00
- **任務**: 5.7 MT-M4b 調金額 + 確認（quote_confirmed 事件落地）
- **範圍**: `supabase/migrations/0005_quote_actions.sql`、`src/domains/pricing/quoteActionsService.ts`、`quoteActionsRepository.ts`、`PATCH/POST` 兩支 API、`QuoteActions.tsx`

## 結論

### 1. 用 Postgres RPC 解決「兩個 status 存兩份」的一致性問題

`quotes.status` 與 `sessions.status` 是同一份狀態存了兩份，而 **Supabase JS 不提供多語句 transaction**。確認動作必須同時推進兩者。

否決「應用層順序寫入」：若 session 更新成功、quote 失敗，重按確認會撞上狀態機（`confirmed` 不接受 `quote_confirmed`）而卡死，得靠額外修復分支繞過——用隱性陷阱換「不寫 migration」。

決策：migration 0005 的兩個 plpgsql function，在單一 transaction 內完成跨表寫入 + CAS。

### 2. RPC 內不放業務知識（最重要的分工原則）

合法轉移由應用層狀態機（`transitions.ts`）判定，把 `from_status` / `to_status` 當**參數**傳進 RPC。RPC 只做兩件事：單一 transaction 的跨表寫入、CAS（`WHERE status = p_from_status`）。

若把 `awaiting_review → confirmed` 硬編進 SQL，狀態機就有兩份定義，必然腐爛。

### 3. 調金額以「手動調整」明細列補差額

不變式：**`sum(price_line_items.amount) == quotes.final_amount` 恆成立**。`adjust_quote_amount` 自算差額並寫入一列調整明細（先刪再插，重複調整不累積）。

理由不是資料潔癖：5.8 的報價信會同時列出明細與總額寄給客戶，對不上客戶就會問。

識別條件 `rule_id IS NULL AND modifier_id IS NULL` 唯一標識調整列——已驗證 `basePricing.ts:79-96` 產出的明細必帶 `rule_id`（基礎費）或 `modifier_id`（加成）其中之一。

### 4. `UPDATE quotes` 必須是 RPC 的第一個語句（承重牆）

`adjust_quote_amount` 的並發安全**完全來自語句順序**：`UPDATE quotes` 先取得該列的 row lock，把並發的第二個 PATCH 阻塞住，使後面的「刪 → 算 → 插」被序列化。若挪到最後，兩個並發 PATCH 會各自以相同 `base_sum` 算差額並各插一列，明細加總直接爆掉。

已在 SQL 與 spec 補上明確註解——這是重構時最容易被無意破壞的地方。

### 5. `adjustQuoteAmount` 必須以 session 狀態當閘門（code review 修正）

計價 pipeline 的寫入順序是「建 quote（已 `awaiting_review`）→ 寫明細 → 推進 session」（`resolveAfterParse.ts:126-146`）。只看 `quote.status` 就放行的話，PATCH 可能落在「quote 已待審、明細還沒進 DB」的窗口內：RPC 以 `base_sum = 0` 算差額 → 插入等於全額的調整列 → pipeline 補上基礎明細 → 不變式破裂。

session 狀態是 pipeline **最後**才推進的，拿它當閘門即可保證明細已完整落地，順帶補上 session 歸屬複查（與 `confirmQuote` 對稱）。

## 行動項目

- [ ] 8.3 安全審查：`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC`（目前 anon/authenticated 對 sessions/price_line_items 無 UPDATE 權限故不可利用，但防禦縱深應補）
- [ ] 5.8 寄信：報價信模板可直接依賴「明細加總 == 總額」不變式，不需處理差額特殊情況
- [ ] 未來若新增 `rule_id` 與 `modifier_id` 皆為 NULL 的明細類型，必須改 `adjust_quote_amount` 的刪除條件

## 影響評估

- **嚴重度**: HIGH（資料一致性與租戶隔離）
- **影響範圍**: `domains/pricing` 的終審動作；5.8 直接建立其上
