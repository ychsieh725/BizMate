-- ── 公開端點濫用防護：rate_limits 固定視窗計數 ────────────────────
-- 動機：/api/sessions 系列完全公開、免驗證，任何人都能灌爆、耗盡 Gemini
--       免費層額度（SDS §13.3、NFR-7）。Serverless 多實例不共享記憶體、
--       冷啟即清空，故限流狀態必須落在 durable store —— 用現有 Supabase，
--       不引入 Redis 等新依賴。
-- 演算法：固定視窗（fixed window）。以 (bucket_key, window_start) 為唯一鍵
--         累計；window_start 由呼叫端對齊整點視窗後傳入。對「基本防護」足夠，
--         不做成本更高的滑動視窗。
-- 原子性：increment_rate_limit() 以單一 upsert 同時完成「計數 + 上限判斷」，
--         避免 read-then-write 競態；達上限時由 ON CONFLICT 的 WHERE 擋下更新。

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key   TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

COMMENT ON TABLE rate_limits IS
  '公開端點固定視窗限流計數（SDS §13.3、NFR-7）。一列 = 某 bucket 在某視窗的請求數。';

-- 與其他表一致：啟用 RLS 且不建 public policy —— 僅 service_role 可存取，
-- anon/authenticated 全擋（限流資料不對外）。
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- 授權：0001 的 GRANT ALL ON ALL TABLES 只涵蓋當時已存在的表，本表為後建，
-- 須顯式授權 service_role，否則 RPC（SECURITY INVOKER）會 permission denied。
GRANT SELECT, INSERT, UPDATE ON rate_limits TO service_role;

-- 原子計數 + 上限判斷。
-- 回傳 TRUE  = 本次請求允許（已計入）；
-- 回傳 FALSE = 已達上限（未計入，應回 429）。
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_bucket_key   TEXT,
  p_window_start TIMESTAMPTZ,
  p_limit        INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO rate_limits (bucket_key, window_start, count)
  VALUES (p_bucket_key, p_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = rate_limits.count + 1
    WHERE rate_limits.count < p_limit
  RETURNING count INTO new_count;

  -- new_count 為 NULL 代表 ON CONFLICT 的 WHERE 未通過（已達上限、未更新該列）。
  RETURN new_count IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION increment_rate_limit IS
  '固定視窗原子限流：計入並回傳是否允許（前 p_limit 次為 TRUE，超出為 FALSE）。';

-- 註：舊視窗列會累積，可日後以排程（pg_cron）清理 window_start 過期資料；
--     對計數正確性無影響，P0 暫不處理。
