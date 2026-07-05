-- ── quotes 增補：保守估算標示 ────────────────────────────────────
-- 動機：反問輪數用盡仍有欄位不明時，系統以保守假設估價（FR-CL-3）。這類報價
--       必須讓接案者在 LINE 終審預覽中一眼看出是「保守估算」而非完整確認的報價，
--       以便判斷是否需要親自向客戶再確認。
-- 決策：一筆報價一個布林旗標，語意最清楚；LINE 預覽（4.8）直接讀此欄位決定是否
--       顯示「保守估算」標示。預設 false（正常報價），反問用盡路徑才設 true。
-- 相容：NOT NULL DEFAULT false，既有列自動補 false，無破壞性。
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS is_conservative BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN quotes.is_conservative IS
  '此報價是否為反問輪數用盡後的保守估算（FR-CL-3）。true 時 LINE 預覽標示「保守估算」。';
