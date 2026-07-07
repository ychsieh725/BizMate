-- BizMate 初始 schema — 多租戶版（多使用者 SaaS 重構，取代舊單一接案者 schema）
-- 執行方式：貼進 Supabase → SQL Editor → Run
--   ⚠ 舊 schema 重建：先執行 supabase/reset_legacy.sql 清除舊表，再跑本檔。
-- 特性：冪等（可重複執行）；所有表顯式啟用 RLS（deny-by-default，service_role 繞過）。
-- 多租戶原則：merchants 為 tenant 根（1:1 對應 auth.users）；
--   sessions / rate_card_* / quotes 直接持有 merchant_id，
--   raw_inputs / extracted_fields / clarification_turns / price_line_items
--   經 session_id 間接歸屬，不冗餘加欄位。

BEGIN;

-- ── 1. Enum 型別 ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE case_category AS ENUM ('graphic_design', 'illustration', 'web_design');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 8 態：LINE 時代的 revising 已淘汰；awaiting_freelancer 更名 awaiting_review
-- （終審通路自 LINE Bot 改為網頁後台）。
DO $$ BEGIN
  CREATE TYPE session_status AS ENUM (
    'created', 'parsing', 'awaiting_clarification',
    'pricing', 'awaiting_review',
    'confirmed', 'sent', 'abandoned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM ('draft', 'awaiting_review', 'confirmed', 'sent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Merchants（tenant 根）─────────────────────────────────
-- id 直接複用 auth.users.id（Supabase 標準 profiles 模式）：天然 1:1、省 FK 欄位。
-- 列的建立走應用層 onboarding API（冪等），不用 DB trigger —— slug 生成與
-- 範本價目表複製屬應用邏輯，trigger 難測試。
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  public_slug TEXT NOT NULL UNIQUE
    CHECK (public_slug ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  contact_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE merchants IS
  '商家（tenant 根，1:1 對應 auth.users）。public_slug 即專屬報價連結 /q/{slug}。';
COMMENT ON COLUMN merchants.contact_email IS
  '報價信的 reply-to；客戶回信直達商家。';

-- ── 3. 客戶端輸入與解析 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
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

-- ── 4. Rate Card（per-merchant，商家於後台自行管理）──────────
CREATE TABLE IF NOT EXISTS rate_card_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  category case_category NOT NULL,
  subtype TEXT NOT NULL,
  unit TEXT NOT NULL,
  base_price NUMERIC(10,2),
  includes TEXT,
  UNIQUE (merchant_id, category, subtype)
);

COMMENT ON COLUMN rate_card_base.includes IS
  '此基礎價包含的基本服務說明（例：3款初稿、2次修改、交付原始檔）。自然語言，供報價單顯示與 Agent 判斷內含範圍。';

CREATE TABLE IF NOT EXISTS rate_card_modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  category case_category,  -- NULL 表該商家跨類型共用
  modifier_name TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  range_min NUMERIC(6,4),  -- 0.2000 代表 20%
  range_max NUMERIC(6,4)
);

CREATE INDEX IF NOT EXISTS idx_rate_card_modifiers_merchant
  ON rate_card_modifiers(merchant_id);

-- ── 5. Rate Card 範本（全域，無 tenant 維度）─────────────────
-- 新商家 onboarding 時整份複製到自己名下作為起始價目表——
-- 空價目表會讓計價直接 out_of_scope，範本讓「註冊完即可發連結」成立。
CREATE TABLE IF NOT EXISTS rate_card_template_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category case_category NOT NULL,
  subtype TEXT NOT NULL,
  unit TEXT NOT NULL,
  base_price NUMERIC(10,2),
  includes TEXT,
  UNIQUE (category, subtype)
);

CREATE TABLE IF NOT EXISTS rate_card_template_modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category case_category,  -- NULL 表跨類型共用
  modifier_name TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  range_min NUMERIC(6,4),
  range_max NUMERIC(6,4)
);

COMMENT ON TABLE rate_card_template_base IS
  '全域價目表範本（建議預設值）。onboarding 時複製到 rate_card_base 給新商家。';

-- ── 6. 報價 ──────────────────────────────────────────────────
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

-- merchant_id 冗餘自 sessions：quote_code 流水號的唯一性範圍是「商家」，
-- 且後台報價列表以 merchant_id 直查，不必每次 join sessions。
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  quote_code TEXT NOT NULL,
  final_amount NUMERIC(10,2),
  status quote_status NOT NULL DEFAULT 'draft',
  is_conservative BOOLEAN NOT NULL DEFAULT false,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (merchant_id, quote_code)
);

COMMENT ON COLUMN quotes.is_conservative IS
  '此報價是否為反問輪數用盡後的保守估算（FR-CL-3）。true 時後台審核頁標示「保守估算」。';

-- ── 7. Eval 與 FinOps（append-only，內部工具，無 tenant 維度）─
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
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 8. 索引 ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_merchant ON sessions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_quotes_merchant ON quotes(merchant_id);
CREATE INDEX IF NOT EXISTS idx_cost_logs_session ON cost_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_price_line_items_session ON price_line_items(session_id);

-- ── 9. RLS：所有表 deny-by-default ───────────────────────────
-- 匿名客戶 wizard 全走 server route + service_role；
-- 商家自有資料表的 auth.uid() owner policy 於後續 migration（M2）加入作第二道防線。
ALTER TABLE merchants                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_inputs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_fields             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clarification_turns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_base               ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_modifiers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_template_base      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card_template_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_line_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_runs                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_logs                    ENABLE ROW LEVEL SECURITY;

-- ── 10. 授權：伺服器端 service_role 全存取 ───────────────────
-- 顯式 GRANT 讓 migration 自帶保證；後續 migration 新建表須各自 GRANT
--（GRANT ALL ON ALL TABLES 只涵蓋當下已存在的表）。
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;

COMMIT;
