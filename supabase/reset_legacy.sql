-- ⚠ 破壞性腳本：清除舊「單一接案者」schema，供多租戶重建使用。
-- 僅在確認 DB 無需保留資料時執行（目前只有 seed 示範價目表）。
-- 執行順序：本檔 → migrations/0001_init.sql → migrations/0002_rate_limits.sql → pnpm seed。

BEGIN;

-- 舊表（含已淘汰的 line_binding / revision_turns）
DROP TABLE IF EXISTS revision_turns CASCADE;
DROP TABLE IF EXISTS line_binding CASCADE;
DROP TABLE IF EXISTS price_line_items CASCADE;
DROP TABLE IF EXISTS quotes CASCADE;
DROP TABLE IF EXISTS clarification_turns CASCADE;
DROP TABLE IF EXISTS extracted_fields CASCADE;
DROP TABLE IF EXISTS raw_inputs CASCADE;
DROP TABLE IF EXISTS cost_logs CASCADE;
DROP TABLE IF EXISTS eval_runs CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS rate_card_base CASCADE;
DROP TABLE IF EXISTS rate_card_modifiers CASCADE;
DROP TABLE IF EXISTS rate_card_template_base CASCADE;
DROP TABLE IF EXISTS rate_card_template_modifiers CASCADE;
DROP TABLE IF EXISTS merchants CASCADE;
DROP TABLE IF EXISTS rate_limits CASCADE;

DROP FUNCTION IF EXISTS increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER);

-- 舊 enum（session_status 值集已改，必須重建）
DROP TYPE IF EXISTS revision_channel;
DROP TYPE IF EXISTS session_status;
DROP TYPE IF EXISTS quote_status;
DROP TYPE IF EXISTS case_category;

COMMIT;
