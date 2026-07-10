-- ── rate_card_base 軟刪除欄位 ──────────────────────────────────
-- price_line_items.rule_id REFERENCES rate_card_base(id) 未指定 ON DELETE，
-- 預設 NO ACTION：真實 DELETE 一列已被歷史報價引用過的 rate_card_base
-- 會被資料庫擋下（外鍵違反）。改用 is_active 標記表示「已停售」，
-- 既有引用完整保留，計價查詢另加 is_active = true 過濾排除停售項目。

BEGIN;

ALTER TABLE rate_card_base
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

COMMIT;
