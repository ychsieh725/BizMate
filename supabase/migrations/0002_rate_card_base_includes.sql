-- ── rate_card_base 增補：基礎服務內容說明 ──────────────────────
-- 動機：base_price 只有一個數字，Formatter/Pricing Agent 與客戶都無從得知
--       「這個基礎價包含哪些服務」（幾款初稿、幾次修改、交付什麼檔案…）。
--       缺這段說明，就無法判斷什麼算「基礎內含」、什麼該走 modifier 加購。
-- 決策：一段 (category, subtype) ↔ 一段說明，嚴格一對一、與 base_price 同擁有者
--       同生命週期，故直接作為 rate_card_base 的欄位，而非另開表。
-- 型別：TEXT 而非 JSONB — 用途為 agent context 與報價單顯示，不需逐項比對；
--       與 rate_card_modifiers.trigger_condition 同以自然語言描述，保持一致。
-- 相容：nullable，與 base_price 一樣允許先留空、由接案者於 Studio 漸進填入。
ALTER TABLE rate_card_base
  ADD COLUMN IF NOT EXISTS includes TEXT;

COMMENT ON COLUMN rate_card_base.includes IS
  '此基礎價包含的基本服務說明（例：3款初稿、2次修改、交付原始檔）。自然語言，供報價單顯示與 Agent 判斷內含範圍。';
