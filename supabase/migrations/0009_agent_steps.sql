-- ── agent_steps：tool-calling agent 的決策軌跡（A1）────────────────────
-- 動機：agent 化之後，系統多出一種現行架構沒有的失效模式——「結果對但路徑
--       荒謬」。agent 可能繞了 7 步、重複查 3 次 rate card、或在無效迴圈裡
--       打轉，而最終欄位仍然抽對。既有的 cost_logs 只記「呼叫了幾次 LLM、
--       花了多少錢」，看不出「它為什麼這樣走」；price_line_items 的
--       agent_reasoning 是單點理由，不是完整軌跡。沒有這張表，多步 agent
--       等於不能除錯，商家看到怪金額也無從回溯。
--
-- 為何 status 用 enum 而非設計文件寫的 TEXT：
--       設計文件 v3 的 DDL 草案寫 TEXT，此處刻意改用 enum。理由是本專案既有
--       的狀態欄位（session_status、quote_status）一律為 enum，TEXT 會讓
--       'rejcted' 這類拼字錯誤靜默寫入、直到查詢時才發現軌跡對不上。
--       代價是新增值需 ALTER TYPE ADD VALUE 且不可逆（見 0008 的說明），
--       但這四個值對應 agent loop 的四種結局，屬於設計層的封閉集合，
--       不是會隨業務長出新值的欄位。
--
-- 為何刻意不加 merchant_id：
--       沿用 cost_logs、price_line_items 既有的子表慣例——租戶隔離透過
--       session_id 外鍵達成，不在子表重複 denormalize。多一份 merchant_id
--       就多一個會與 sessions 不一致的來源。
--
-- 為何 UNIQUE (run_id, step_index)：
--       軌跡寫入是 best-effort，重試可能造成同一步被寫兩次。有了這條約束，
--       重複寫入會撞違反約束而被上層靜默吞掉（正確行為），軌跡保持無歧義。
--
-- 為何 cost_log_id 可為 NULL：
--       並非每個 step 都會呼叫 LLM。lookup_rate_card 是純 DB 查詢、
--       compute_quote 是確定性計價，兩者成本為 0、無對應 cost_logs 紀錄。
--       ON DELETE SET NULL 而非 CASCADE：成本紀錄被清理時不該連帶銷毀軌跡，
--       軌跡本身仍有除錯價值。
--
-- 影響：純新增一張表與一個 enum，無既有資料異動。此表在 A4 之前不會有寫入
--       （agent loop 尚未接上），對現行流程零影響。

BEGIN;

-- agent loop 中單一 step 的結局。
--   ok       — tool 正常執行完成
--   rejected — 參數不合 schema／欄位不在白名單，已回錯誤讓 agent 重試
--   error    — tool 執行時拋錯（含 LLM 呼叫失敗）
--   fallback — 預算用盡／偵測到迴圈，該步為退回既有路徑的標記
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_step_status') THEN
    CREATE TYPE agent_step_status AS ENUM ('ok', 'rejected', 'error', 'fallback');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS agent_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- 同一次 agent loop 的所有 step 共用；一個 session 可能跑多次 loop
  -- （describe 一次、每輪 answer 各一次），故不能用 session_id 當軌跡分組。
  run_id       UUID NOT NULL,
  step_index   INTEGER NOT NULL,
  tool_name    TEXT NOT NULL,
  -- 存原始的 tool 參數與回傳，供事後重建當時的決策情境。
  tool_args    JSONB,
  tool_result  JSONB,
  status       agent_step_status NOT NULL,
  error_detail TEXT,
  cost_log_id  UUID REFERENCES cost_logs(id) ON DELETE SET NULL,
  latency_ms   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_steps_run_step_unique UNIQUE (run_id, step_index),
  CONSTRAINT agent_steps_step_index_non_negative CHECK (step_index >= 0)
);

-- 商家後台查單張報價的完整軌跡。
CREATE INDEX IF NOT EXISTS idx_agent_steps_session ON agent_steps(session_id);
-- 依 run 取回有序軌跡（eval 的 trajectory 指標與後台軌跡 UI 都走這條）。
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, step_index);

-- deny-by-default，與 0001 建立的所有表一致。
-- 客戶 wizard 與 agent-service 皆以 service_role 寫入；
-- 商家端讀取經 session 歸屬檢查，不直接開放 table 權限。
ALTER TABLE agent_steps ENABLE ROW LEVEL SECURITY;

-- 0001 的 GRANT ALL ON ALL TABLES 只涵蓋當下已存在的表，新表須各自 GRANT。
GRANT ALL PRIVILEGES ON TABLE agent_steps TO service_role;

COMMIT;
