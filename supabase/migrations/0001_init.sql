-- BizMate 初始 schema（對應 SDS §3.1–3.6）
-- 執行方式：貼進 Supabase → SQL Editor → Run
-- 特性：冪等（可重複執行）；所有表顯式啟用 RLS（deny-by-default，service_role 繞過）

BEGIN;

-- ── 3.1 Enum 型別 ────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE case_category AS ENUM ('graphic_design', 'illustration', 'web_design');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM (
    'created', 'parsing', 'awaiting_clarification',
    'pricing', 'awaiting_freelancer', 'revising',
    'confirmed', 'sent', 'abandoned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM ('draft', 'awaiting_freelancer', 'confirmed', 'sent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE revision_channel AS ENUM ('line_text', 'line_postback');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3.2 客戶端輸入與解析 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category case_category NOT NULL,
  contact_email TEXT,
  status session_status NOT NULL DEFAULT 'created',
  current_step SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extracted_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  value TEXT,
  confidence NUMERIC(4,3),
  source_span TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, field_name)
);

CREATE TABLE IF NOT EXISTS clarification_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  round SMALLINT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  triggered_field TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3.3 Rate Card（數字先留 NULL，接案者於 Table Editor 填入）──
CREATE TABLE IF NOT EXISTS rate_card_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category case_category NOT NULL,
  subtype TEXT NOT NULL,
  unit TEXT NOT NULL,
  base_price NUMERIC(10,2),
  UNIQUE (category, subtype)
);

CREATE TABLE IF NOT EXISTS rate_card_modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category case_category,  -- NULL 表跨類型共用（附錄 A.1）
  modifier_name TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  range_min NUMERIC(6,4),  -- 0.2000 代表 20%
  range_max NUMERIC(6,4)
);

-- ── 3.4 報價與修改歷程 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  rule_id UUID REFERENCES rate_card_base(id),
  modifier_id UUID REFERENCES rate_card_modifiers(id),
  agent_reasoning TEXT,
  confidence NUMERIC(4,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  quote_code TEXT NOT NULL UNIQUE,
  final_amount NUMERIC(10,2),
  status quote_status NOT NULL DEFAULT 'draft',
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS revision_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  round SMALLINT NOT NULL,
  channel revision_channel NOT NULL,
  raw_message TEXT,
  parsed_action JSONB,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3.5 LINE 綁定（並發報價核心表，MVP 僅一列）──────────────
CREATE TABLE IF NOT EXISTS line_binding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_line_user_id TEXT NOT NULL UNIQUE,
  active_session_id UUID REFERENCES sessions(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3.6 Eval 與 FinOps（append-only）─────────────────────────
CREATE TABLE IF NOT EXISTS eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value NUMERIC,
  model_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cost_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd NUMERIC(10,6) NOT NULL,
  latency_ms INTEGER,  -- 該次 LLM 呼叫耗時（SDS v0.2 修正）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 索引 ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cost_logs_session ON cost_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_price_line_items_session ON price_line_items(session_id);
CREATE INDEX IF NOT EXISTS idx_revision_turns_session ON revision_turns(session_id);

-- ── RLS：所有表 deny-by-default（無 policy = 公開零存取；service_role 繞過）──
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_inputs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_fields     ENABLE ROW LEVEL SECURITY;
ALTER TABLE clarification_turns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_base       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_modifiers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_line_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_turns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_binding         ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_logs            ENABLE ROW LEVEL SECURITY;

-- ── 授權：伺服器端 service_role 全存取（anon/authenticated 不授權 = 對外鎖死）──
-- 讓 migration 自帶保證，不依賴 dashboard「自動 expose」開關。
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;

COMMIT;
