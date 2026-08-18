-- ── 調價 diff 品質指標（WBS 6.4）────────────────────────────────────────
-- 動機：現行的品質量測全部是離線的——golden set 36 則、人工標註、跑一次十幾
--       分鐘。它回答的是「模型在我準備的題目上表現如何」，但沒有任何東西回答
--       「上線後真實表現如何」。
--
--       而那個答案其實已經躺在資料庫裡：商家每次調整 AI 的報價，就等於標註了
--       一次「AI 差了多少」。零標註成本、零 API 成本、隨業務即時累積。
--       0005 的 adjust_quote_amount 早就在記錄它，只是從來沒人去算。
--
-- 為何用 view 而非新表：
--       這是既有資料的**衍生檢視**，不是新事實。建表就得處理同步問題（調價後
--       忘了更新統計表），而衍生值與來源不一致比沒有統計更糟。
--
-- 為何 security_invoker：
--       view 預設以「定義者」的權限執行，會直接繞過底層表的 RLS——任何登入
--       使用者都能讀到所有商家的報價金額。security_invoker = true 讓查詢改以
--       「呼叫者」的權限執行，quotes 與 price_line_items 既有的 owner policy
--       因此照常生效。**這一行是整個 migration 最重要的部分。**
--
-- 影響：純新增兩個唯讀 view，無既有資料或結構異動。

BEGIN;

-- ── 每張報價一列的事實表 ────────────────────────────────────────────────
--
-- 分母的選擇是這裡最容易出錯的決定。draft 與 awaiting_review 的報價，商家
-- 還沒看過，把它們算成「未調整」會系統性低估調整率——本專案在「端到端成功率」
-- 上已經犯過一次同樣的錯（把零資訊輸入算成失敗），故此處只納入商家真的做過
-- 決定的報價。
--
-- abandoned（婉拒）同樣排除：那代表整張報價被拒絕，沒有「定稿」可以跟 AI 的
-- 數字相比，算成「未調整」會讓指標好看但沒有意義。
CREATE OR REPLACE VIEW quote_adjustment_facts
WITH (security_invoker = true) AS
SELECT
  q.id            AS quote_id,
  q.merchant_id,
  q.created_at,
  q.status,
  -- 保守估算的報價本來就預期被調整較多（資訊不足時的下限估計）。
  -- 不從分母排除，而是留成欄位供切片——排除掉就看不見「保守估算到底準不準」。
  q.is_conservative,
  s.category,
  q.final_amount,
  -- 手動調整列的識別條件與 0005 的 adjust_quote_amount 一致：rule_id 與
  -- modifier_id 皆為 NULL。兩處必須同步，否則這裡會算到錯的列。
  -- 0005 是「先刪再插」，故每個 session 至多一列，COALESCE 到 0 即為未調整。
  COALESCE(adj.amount, 0) AS adjustment_amount,
  -- AI 原本算出的金額：總額扣掉手動調整的差額。
  q.final_amount - COALESCE(adj.amount, 0) AS ai_amount,
  -- 調幅（相對 AI 原始金額）。AI 金額為 0 或 NULL 時給 NULL 而非 0：
  -- 「算不出來」與「沒有偏差」是不同的事實，混用會讓平均值被灌水。
  CASE
    WHEN q.final_amount IS NULL THEN NULL
    WHEN q.final_amount - COALESCE(adj.amount, 0) = 0 THEN NULL
    ELSE adj.amount / (q.final_amount - COALESCE(adj.amount, 0))
  END AS adjustment_ratio,
  (adj.amount IS NOT NULL) AS was_adjusted
FROM quotes q
JOIN sessions s ON s.id = q.session_id
LEFT JOIN price_line_items adj
  ON adj.session_id = q.session_id
 AND adj.rule_id IS NULL
 AND adj.modifier_id IS NULL
WHERE q.status IN ('confirmed', 'sent')
  -- 查無費率而轉人工的報價沒有 AI 金額可比。
  AND q.final_amount IS NOT NULL;

COMMENT ON VIEW quote_adjustment_facts IS
  '每張「商家已決定」的報價一列，含 AI 原始金額與人工調整差額。線上品質指標的原料，零標註成本。';

-- ── 按月聚合 ────────────────────────────────────────────────────────────
--
-- 趨勢是這三個指標裡唯一能回答「改了 prompt 之後有沒有變好」的。單一時點的
-- 調整率無法解讀——20% 是高是低取決於商家的價目表精細度，但「從 20% 降到
-- 12%」就是明確的訊號。
CREATE OR REPLACE VIEW quote_adjustment_monthly
WITH (security_invoker = true) AS
SELECT
  merchant_id,
  category,
  date_trunc('month', created_at) AS month,
  COUNT(*)                                        AS decided_quotes,
  COUNT(*) FILTER (WHERE was_adjusted)            AS adjusted_quotes,
  -- 調整率：被商家改過價的比例。
  COUNT(*) FILTER (WHERE was_adjusted)::NUMERIC / COUNT(*) AS adjustment_rate,
  -- 平均調幅只取「有調整且算得出比率」的報價：把未調整的 0 也平均進去，
  -- 得到的是調整率與調幅的乘積，那個數字沒有意義。
  AVG(ABS(adjustment_ratio)) FILTER (WHERE was_adjusted) AS avg_abs_adjustment_ratio,
  -- 帶正負號的平均：看得出 AI 是系統性低估還是高估。
  AVG(adjustment_ratio) FILTER (WHERE was_adjusted)      AS avg_signed_adjustment_ratio
FROM quote_adjustment_facts
GROUP BY merchant_id, category, date_trunc('month', created_at);

COMMENT ON VIEW quote_adjustment_monthly IS
  '按商家、類別、月份聚合的調價指標：調整率、平均調幅（絕對值與帶號）。趨勢用。';

-- 0001 的 GRANT ALL ON ALL TABLES 只涵蓋當下已存在的物件，新 view 須各自 GRANT。
--
-- **只給 service_role，不給 authenticated。** 後台一律以 service_role 於伺服器端
-- 查詢並在應用層帶 merchant_id 過濾（見 requireMerchant），瀏覽器不直查這個 view。
--
-- 要讓瀏覽器讀得到，還得額外 GRANT SELECT ON price_line_items TO authenticated
-- （0003 只開了 merchants / quotes / sessions / rate_card_*）。那是擴大攻擊面的
-- 決定，應該在真的需要時明確做出，而不是隨這個 view 一起被順手帶進來。
--
-- 在此之前，authenticated 查這個 view 會得到 permission denied，屬 fail closed。
-- 先 REVOKE 再 GRANT，讓這個 migration 可重複執行。
-- GRANT 是累加的：本檔的初版曾一併授予 authenticated，若不明確撤銷，
-- 在已套用過初版的資料庫上重跑只會保留那份多餘的權限。
-- 未曾授予時 REVOKE 為 no-op，對全新資料庫無影響。
REVOKE ALL ON quote_adjustment_facts   FROM authenticated;
REVOKE ALL ON quote_adjustment_monthly FROM authenticated;

GRANT SELECT ON quote_adjustment_facts   TO service_role;
GRANT SELECT ON quote_adjustment_monthly TO service_role;

-- security_invoker 為何仍然保留：
-- 上述 GRANT 讓 authenticated 目前碰不到這個 view，但那是權限層的偶然結果，
-- 不是設計保證。哪天有人為了別的需求開了 price_line_items 的讀取權，
-- security_invoker 是唯一還站著的防線——沒有它，view 會在那一刻起無聲地
-- 把所有商家的報價金額攤開給每個登入使用者。

COMMIT;
