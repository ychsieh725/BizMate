-- ── 收緊 RPC 執行權限：從 PUBLIC 收回 EXECUTE（防禦縱深，8.3 安全審查）─────
-- 動機：Postgres 對 FUNCTION 的預設行為是「自動 GRANT EXECUTE TO PUBLIC」。
--       0005/0006 只顯式 GRANT EXECUTE 給 service_role，但從未從 PUBLIC 收回，
--       因此 anon / authenticated 角色目前也能 EXECUTE 這三個 RPC。
--
-- 目前是否可被利用：否（已於 8.3 逐條核對 grant 確認）。
--       這三個函式皆為 LANGUAGE plpgsql 且未標 SECURITY DEFINER →
--       預設 SECURITY INVOKER，函式體內的 UPDATE/DELETE/INSERT 以「呼叫者」
--       權限執行。而 anon/authenticated 對 quotes/sessions 僅有 SELECT（0003）、
--       對 price_line_items/rate_limits 完全無 table 權限，故直接呼叫這些 RPC
--       會在第一個寫入語句即 permission denied，無法造成資料異動或外洩。
--
-- 為何仍要修：這是「防禦縱深負債」。目前不可利用的前提，完全依賴
--       「未來沒有任何 migration 意外對 authenticated 開放這些表的寫入權限」。
--       一旦某天為了別的需求 GRANT 了 UPDATE，PUBLIC EXECUTE 就會瞬間變成
--       可被利用的越權寫入路徑。最小權限原則：應用層一律以 service_role 呼叫
--       這些 RPC（見 quoteActionsRepository.ts、rateLimit.ts），PUBLIC 本就不需要
--       執行權，直接收回、縮小攻擊面。
--
-- 影響：無破壞性。應用端所有呼叫皆走 service_role（getSupabaseClient()），
--       service_role 的 EXECUTE 由 0005/0006 顯式 GRANT 保留，不受本檔影響。
--
-- 冪等：REVOKE 對「本就沒有的權限」是 no-op，可重複執行。

BEGIN;

-- 報價狀態原子推進（0006 的現行版本；0005 的舊 confirm_quote 已於 0006 DROP）。
REVOKE EXECUTE ON FUNCTION advance_quote_status(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;

-- 報價金額原子調整（0005）。
REVOKE EXECUTE ON FUNCTION adjust_quote_amount(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;

-- 公開端點限流計數（0002）。
REVOKE EXECUTE ON FUNCTION increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC;

-- 再次確認 service_role 保有執行權（顯式、與 REVOKE 對稱，讓本檔自帶保證）。
GRANT EXECUTE ON FUNCTION advance_quote_status(UUID, UUID, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION adjust_quote_amount(UUID, UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER) TO service_role;

COMMIT;
