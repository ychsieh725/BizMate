-- ── 改名 confirm_quote → advance_quote_status（5.8 MT-M5）──────────
-- 動機：confirm_quote（5.7 建立）SQL 內沒有任何業務邏輯，只是「CAS 同步
--       quotes.status 與 sessions.status 兩表」，from/to status 全由參數
--       決定。confirmed → sent（本任務）面臨與 awaiting_review → confirmed
--       完全相同的雙表原子性問題，故重用而非新建近乎相同的 RPC（DRY）。
--       改名讓函式簽名誠實反映它的通用性。
--
-- 擴充：新增 p_set_sent_at 參數（預設 FALSE，不影響 5.7 既有呼叫行為）。
--       寄送報價時傳 TRUE，由本函式一併寫入 quotes.sent_at = now()，
--       不為「寫入時間戳」這個小事另開一個函式。

BEGIN;

DROP FUNCTION IF EXISTS confirm_quote(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION advance_quote_status(
  p_quote_id     UUID,
  p_merchant_id  UUID,
  p_from_status  TEXT,
  p_to_status    TEXT,
  p_set_sent_at  BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_session_id   UUID;
  v_quote_rows   INTEGER;
  v_session_rows INTEGER;
BEGIN
  UPDATE quotes
     SET status  = p_to_status::quote_status,
         sent_at = CASE WHEN p_set_sent_at THEN now() ELSE sent_at END
   WHERE id = p_quote_id
     AND merchant_id = p_merchant_id
     AND status = p_from_status::quote_status
  RETURNING session_id INTO v_session_id;

  GET DIAGNOSTICS v_quote_rows = ROW_COUNT;
  IF v_quote_rows = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE sessions
     SET status = p_to_status::session_status
   WHERE id = v_session_id
     AND merchant_id = p_merchant_id
     AND status = p_from_status::session_status;

  GET DIAGNOSTICS v_session_rows = ROW_COUNT;
  IF v_session_rows = 0 THEN
    RAISE EXCEPTION
      'advance_quote_status: session % 不在 % 狀態，已回滾', v_session_id, p_from_status;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION advance_quote_status IS
  '原子推進報價狀態：單一 transaction 內以 CAS 同時推進 quotes.status 與
   sessions.status；p_set_sent_at=TRUE 時一併寫入 quotes.sent_at。
   前身為 confirm_quote（5.7），因應 5.8 的寄送轉移改名為通用語意並擴充參數。';

GRANT EXECUTE ON FUNCTION advance_quote_status(UUID, UUID, TEXT, TEXT, BOOLEAN) TO service_role;

COMMIT;
