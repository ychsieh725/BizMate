-- ── 後台終審的兩個原子動作（5.7 MT-M4b）────────────────────────
-- 動機：quotes.status 與 sessions.status 是同一份狀態存兩份，而 Supabase JS
--       不提供多語句 transaction。確認動作必須同時推進兩者，否則會出現
--       「列表顯示待審、但 session 已 confirmed」的半套資料。
--
-- 分工原則：RPC 內不放業務知識。合法轉移由應用層的狀態機（transitions.ts）
--       判定後，把 from/to status 當參數傳入；RPC 只負責
--       ① 單一 transaction 的跨表寫入 ② CAS（WHERE status = p_from_status）。
--       若把 awaiting_review → confirmed 硬編進 SQL，狀態機就有兩份定義。
--
-- 授權：0001 的 GRANT 只涵蓋當時已存在的物件，後建的 FUNCTION 必須顯式
--       GRANT EXECUTE 給 service_role，否則呼叫時 permission denied（見 0002）。

BEGIN;

-- 確認報價：原子推進 quotes.status 與 sessions.status。
-- 回傳 TRUE  = 已推進；
-- 回傳 FALSE = CAS 條件不成立（非該商家的報價、或已被確認/寄出、或併發搶先）。
CREATE OR REPLACE FUNCTION confirm_quote(
  p_quote_id    UUID,
  p_merchant_id UUID,
  p_from_status TEXT,
  p_to_status   TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_session_id   UUID;
  v_quote_rows   INTEGER;
  v_session_rows INTEGER;
BEGIN
  -- p_merchant_id 進 WHERE 是防禦縱深第二道（應用層已做歸屬檢查）。
  UPDATE quotes
     SET status = p_to_status::quote_status
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
    -- 兩表狀態不同步（資料不一致，不該發生）。拋例外讓整個 function 回滾——
    -- 絕不留下「quote 已 confirmed 但 session 沒動」的半套資料。
    RAISE EXCEPTION
      'confirm_quote: session % 不在 % 狀態，已回滾', v_session_id, p_from_status;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION confirm_quote IS
  '原子確認報價：單一 transaction 內以 CAS 同時推進 quotes.status 與 sessions.status。';

-- 調整最終金額：更新 final_amount，並以「手動調整」明細列補上差額，
-- 使不變式 sum(price_line_items.amount) = quotes.final_amount 恆成立。
-- 回傳 TRUE = 已調整；FALSE = CAS 條件不成立（非該商家、或不在可編輯狀態）。
CREATE OR REPLACE FUNCTION adjust_quote_amount(
  p_quote_id    UUID,
  p_merchant_id UUID,
  p_new_amount  NUMERIC,
  p_from_status TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_session_id UUID;
  v_base_sum   NUMERIC;
  v_diff       NUMERIC;
  v_rows       INTEGER;
BEGIN
  -- ⚠ 承重牆：UPDATE quotes 必須是第一個語句，不可與下方的 DELETE/SUM/INSERT 對調。
  -- 它取得 quotes 該列的 row lock，把並發的第二個 PATCH 阻塞在此，使後續的
  -- 「刪調整列 → 重算加總 → 插新調整列」被序列化。若把它挪到最後，兩個並發的
  -- PATCH 會各自以相同的 base_sum 算差額並各插一列，明細加總直接爆掉。
  UPDATE quotes
     SET final_amount = p_new_amount
   WHERE id = p_quote_id
     AND merchant_id = p_merchant_id
     AND status = p_from_status::quote_status
  RETURNING session_id INTO v_session_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN FALSE;
  END IF;

  -- 手動調整列的唯一識別：rule_id 與 modifier_id 皆為 NULL。
  -- 前提（已驗證 basePricing.ts:79-96）：計價產出的明細必帶 rule_id（基礎費）
  -- 或 modifier_id（加成）其中之一。未來若新增兩者皆 NULL 的明細類型，
  -- 必須改這個識別條件，否則會誤刪。
  -- 先刪再插 → 重複調整不累積多列調整。
  DELETE FROM price_line_items
   WHERE session_id = v_session_id
     AND rule_id IS NULL
     AND modifier_id IS NULL;

  SELECT COALESCE(SUM(amount), 0) INTO v_base_sum
    FROM price_line_items
   WHERE session_id = v_session_id;

  v_diff := p_new_amount - v_base_sum;

  -- 差額為 0 時不插入空列（例如商家把金額改回原值）。
  IF v_diff <> 0 THEN
    INSERT INTO price_line_items (session_id, item_name, amount, agent_reasoning)
    VALUES (
      v_session_id,
      '商家手動調整',
      v_diff,
      '商家於後台終審時調整最終金額'
    );
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION adjust_quote_amount IS
  '原子調整報價金額：更新 final_amount 並以手動調整明細列補差額，維持明細加總 = 總額。';

GRANT EXECUTE ON FUNCTION confirm_quote(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION adjust_quote_amount(UUID, UUID, NUMERIC, TEXT) TO service_role;

COMMIT;
