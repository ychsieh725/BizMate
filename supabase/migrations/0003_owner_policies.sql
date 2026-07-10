-- ── RLS owner policies：防禦縱深（第二道防線）─────────────────────
-- 主要保證仍是應用層 requireMerchant + service_role（見 5.4 spec）。
-- 這裡加的 policy 防的是「繞過我們的 Next.js app、直接用 anon key +
-- 使用者自己的 JWT 打 Supabase 公開 REST API」的情境。
--
-- 關鍵細節：0001_init.sql 只 GRANT 給 service_role，authenticated
-- 角色目前無任何表級權限。CREATE POLICY 與 GRANT 缺一都會查無資料，
-- 本檔兩者同時處理。只開 SELECT——寫入仍全部走 service_role，不擴大
-- 攻擊面。
--
-- 範圍：merchants / rate_card_base / rate_card_modifiers / quotes /
-- sessions 五張表。raw_inputs / extracted_fields / clarification_turns /
-- price_line_items 經 session_id 間接歸屬，計畫文件範圍本就不含，
-- 深層 join policy 留待真正需要時再做。

BEGIN;

CREATE POLICY merchants_owner_select ON merchants
  FOR SELECT TO authenticated
  USING (auth.uid() = id);
GRANT SELECT ON merchants TO authenticated;

CREATE POLICY rate_card_base_owner_select ON rate_card_base
  FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
GRANT SELECT ON rate_card_base TO authenticated;

CREATE POLICY rate_card_modifiers_owner_select ON rate_card_modifiers
  FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
GRANT SELECT ON rate_card_modifiers TO authenticated;

CREATE POLICY quotes_owner_select ON quotes
  FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
GRANT SELECT ON quotes TO authenticated;

CREATE POLICY sessions_owner_select ON sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
GRANT SELECT ON sessions TO authenticated;

COMMIT;
