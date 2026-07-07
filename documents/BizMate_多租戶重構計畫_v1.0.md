# BizMate 多使用者 SaaS 重構計畫

## Context（背景與結論）

BizMate 目前是「單一接案者」的自動化報價系統（PRD §4.2 明確排除多租戶）。M1 已收官：客戶端 Web Wizard → Gemini 解析 → 反問（上限 3 輪）→ deterministic 計價，端到端可跑、221 測試綠。使用者要改成**真實多人產品**：使用者註冊登入、管理自己的服務與價格、取得專屬連結 `/q/{slug}` 給客戶自動報價。

**評估結論：沿用現有程式碼重構，不重寫。** 理由：
- 分層乾淨（Repository Pattern、查表式狀態機、orchestrator 集中），tenant 注入點集中
- 接案者側（LINE 終審 4.6–4.11、admin）**本來就沒實作**——LINE 只存在於 schema 與 env，`src/` 內零 LINE 程式碼，砍掉成本極低
- 唯一要「重寫」的是 migrations（無真實資料，直接重建）

**已拍板決策**：終審改網頁後台（砍 LINE 鏈）｜認證用 Supabase Auth｜DB 重寫 schema 重建｜Eval/FinOps 降級為內部工具。

---

## 1. 新資料模型（migrations 全部重寫）

| 表 | 動作 |
|---|---|
| `merchants` | **新增**（tenant 根） |
| `sessions`、`rate_card_base`、`rate_card_modifiers`、`quotes` | + `merchant_id NOT NULL` |
| `raw_inputs` / `extracted_fields` / `clarification_turns` / `price_line_items` | 不變（經 session_id 間接歸屬） |
| `rate_card_template_base` / `rate_card_template_modifiers` | **新增**（全域範本，內容 = 現有 seed 資料） |
| `line_binding`、`revision_turns` | **淘汰**（含 `revision_channel` enum） |
| `cost_logs` / `eval_runs` / `rate_limits` | 不變 |

**merchants**（Supabase 標準 profiles 模式）：
```
id UUID PK REFERENCES auth.users(id) ON DELETE CASCADE   -- 1:1
display_name TEXT NOT NULL
public_slug  TEXT NOT NULL UNIQUE CHECK (~ '^[a-z0-9][a-z0-9-]{2,31}$')
contact_email TEXT NOT NULL        -- 寄信 reply-to
created_at / updated_at
```
- 不用 DB trigger 建 merchant 列；改**應用層 onboarding API**（冪等）：建列 + slug 自動生成（碰撞重試）+ 複製範本價目表。空價目表會讓 `computeBasePricing` 直接 outOfScope 卡死，所以**新使用者必須給範本**。

**唯一約束改造**：
- `rate_card_base`：`UNIQUE(category, subtype)` → `UNIQUE(merchant_id, category, subtype)`
- `quotes`：`quote_code` 全域 UNIQUE → `UNIQUE(merchant_id, quote_code)`；`generateQuoteCode` 演算法沿用，`countByCodePrefix` 加 merchant 過濾；併發衝突時重試一次（不做 counter RPC，避免過度設計）

**狀態機去 LINE 化**（`session_status` 9 態 → 8 態）：
- 刪 `revising`；`awaiting_freelancer` → 更名 `awaiting_review`
- 刪事件 `line_received` / `revision_applied` / `revision_confirmed`；新增 `quote_confirmed`（awaiting_review → confirmed）
- 後台改金額不需獨立狀態：awaiting_review 下直接 PATCH `final_amount`
- 只動 [transitions.ts](src/orchestrator/transitions.ts) 中段 3 個轉移 + [events.ts](src/orchestrator/events.ts) 型別

**RLS 策略**（防禦縱深，主保證仍是應用層 `requireMerchant` + service_role）：
- `merchants` / `rate_card_*` / `quotes` / `sessions`：加 `authenticated` policy `auth.uid() = merchant_id`
- 匿名客戶 wizard 相關表：維持零 policy（僅 service_role 經 server route）
- 匿名安全模型不變：session UUID 不可猜測即憑證；入口加固——建 session 必須帶合法 slug（查無 404），rate limit 擴為 `IP` + `slug` 雙 bucket

## 2. 認證與路由

- 新依賴 **`@supabase/ssr`**；新 env：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`RESEND_API_KEY`、`EMAIL_FROM`；刪 `LINE_*`、`GMAIL_*`（改 [env.ts](src/lib/env.ts)）
- 新增：`src/lib/supabase/serverClient.ts`（每請求 createServerClient + cookies）、`browserClient.ts`（auth 頁用）；現有 service_role 單例 [client.ts](src/lib/supabase/client.ts) 不動
- 新增 `src/middleware.ts`：刷新 cookie；matcher `/dashboard/:path*`、`/onboarding`，未登入導 `/login`
- 新增 `src/lib/auth/requireMerchant.ts`：所有 dashboard API 第一行呼叫，cookie → auth.uid() → merchants 查詢 → `{merchantId}` 或 401/403。**這是租戶隔離的主要保證**
- 路由：公開 `/`、`/q/[slug]`、`/login`、`/signup`、`/api/sessions/**`；受保護 `/dashboard/**`、`/onboarding`、`/api/dashboard/**`

## 3. API

**既有公開 API**：`POST /api/sessions` body 加 `slug` → `findBySlug` 查無回 404 → `createSession(category, merchantId)`。`describe` / `answer` / `status` **介面完全不變**（session 已載 merchant_id）。

**新增後台 API**（皆過 requireMerchant、皆用現有 apiOk/apiFail 信封；quotes/[id] 跨租戶一律回 404 不回 403）：
```
POST   /api/dashboard/onboarding          建 merchant + 複製範本（冪等）
GET/PATCH /api/dashboard/profile          display_name / slug（衝突 409）
GET/POST /api/dashboard/services          價目表列表 / 新增
PATCH/DELETE /api/dashboard/services/[id]
GET    /api/dashboard/quotes?status=      報價列表
GET    /api/dashboard/quotes/[id]         詳情（line items + 欄位 + 澄清歷程）
PATCH  /api/dashboard/quotes/[id]         調 final_amount（限 awaiting_review）
POST   /api/dashboard/quotes/[id]/confirm 狀態機 quote_confirmed
POST   /api/dashboard/quotes/[id]/send    寄 Email → email_sent → sent
```

## 4. 前端頁面

| 頁面 | 內容 |
|---|---|
| `/signup`、`/login`、`/onboarding` | Supabase Auth email/密碼；onboarding 填 display_name（slug 自動生成可改） |
| `/dashboard` | 待審報價數 + 分享連結一鍵複製 |
| `/dashboard/services` | 價目表 CRUD（inline 編輯；modifiers 先唯讀） |
| `/dashboard/quotes`、`/dashboard/quotes/[id]` | 列表（狀態篩選）＋詳情（調金額/確認/寄送） |
| `/dashboard/settings` | profile 編輯 |
| `/q/[slug]` | 現有 wizard 整組搬遷；server component 解析 slug（查無 notFound()），頁首顯示商家名；4 步驟邏輯零改動 |
| `/admin/**` | 不做——Eval/FinOps 降級為 verify scripts / SQL 直查 |

## 5. merchantId 呼叫鏈（入口解析一次，掛在 session 上）

```
POST /api/sessions (slug→merchantId)
  └ createSession(category, merchantId)               sessionService.ts
describeFlow / answerFlow（簽章不變，session 自帶 merchant_id）
  └ resolveAfterParse({…, merchantId})                參數 +1
      ├ computeBasePricing(merchantId, …)             basePricing.ts
      │   └ rateCardRepository.findBase/findModifiers(merchantId, …)
      ├ generateQuoteCode(merchantId, category)       quoteFormatter.ts
      │   └ quotesRepository.countByCodePrefix(merchantId, prefix)
      └ quotesRepository.create({…, merchant_id})
```

**既有檔案異動**：`supabase/migrations/`（重寫）、`database.types.ts`（重生成）、`env.ts`、`domain.types.ts`（status rename + Merchant 型別）、`transitions.ts` / `events.ts`、`resolveAfterParse.ts`、`describeFlow.ts` / `answerFlow.ts`、`sessionService.ts`、`basePricing.ts`、`quoteFormatter.ts`、`rateCardRepository.ts`、`quotesRepository.ts`、`api/sessions/route.ts`、`wizard/**` → `q/[slug]/**` 搬遷、`routes.ts`、`scripts/seed-rate-card.ts`

**新增檔案**：`middleware.ts`、`lib/supabase/serverClient.ts` + `browserClient.ts`、`lib/auth/requireMerchant.ts`、`lib/email/**`、`domains/merchant/`（merchantsRepository、onboardingService、slug 生成）、`domains/pricing/quoteReviewService.ts`、`app/(auth)/**`、`app/dashboard/**`、`app/api/dashboard/**`

## 6. Email：改用 Resend（不用 Nodemailer + Gmail）

Gmail app password 綁單一開發者帳號 = 單使用者思維；serverless 對 SMTP 不友善。Resend HTTP API（免費 100 封/日），平台域名寄出、`reply_to` 設商家 email。`renderQuoteEmail()` 純函式可測；寄失敗停在 confirmed 可重寄。

## 7. 分階段交付（每階段結束系統可跑、測試綠）

| Milestone | 內容 | 量 | 風險 |
|---|---|---|---|
| **M1 DB 重寫 + tenant 貫穿** | 新 migrations、重生 types、狀態機去 LINE + rename、merchantId 貫穿、wizard 搬 `/q/[slug]`、seed 建 dev merchant（slug=`dev`） | 2–3 天 | 中：status rename 波及 221 測試，一次 grep 全域替換 |
| **M2 Auth + onboarding + dashboard 骨架** | @supabase/ssr、middleware、signup/login/onboarding、requireMerchant、RLS policies、dashboard 首頁分享連結 | 2 天 | 中：cookie/SSR 樣板照官方 |
| **M3 服務項目管理** | services CRUD API + UI | 1–2 天 | 低 |
| **M4 報價後台審核** | quotes 列表/詳情/調金額/confirm | 2 天 | 低 |
| **M5 Email 寄送** | Resend、send API + UI、email_sent → sent | 1 天 | 低 |
| **M6 收尾** | per-slug rate limit、env 清理、verify scripts 過帳、landing 導 signup、settings | 1 天 | 低 |

每個 milestone 遵守專案 git 規範：feat 分支 → 測試綠 → --no-ff 併回 main。

## 8. 驗證方式

- **221 既有測試遷移**（M1 集中處理）：純函式測試約七成僅受 rename + 簽章 +merchantId 影響（機械修改）；route/repo 測試補 merchant_id fixture；刪 LINE 轉移案例、補 `quote_confirmed` 案例
- **新測試（TDD）**：M2 `requireMerchant`（無 cookie 401 / 無 merchant 403）+ slug 生成；M3/M4 重點測**跨租戶隔離**（B 商家 token 取 A 資源 → 404）；M5 `renderQuoteEmail` 快照
- **verify scripts**：`verify-db` 驗新 schema + RLS 存在；既有 verify 開頭 ensure dev merchant；新增 `verify-auth.ts`（signup → onboarding → 用 A 的 JWT + anon key 直查 rate_card_base，確認只回 A 的列，證明 RLS 第二道防線有效）、`verify-email.ts`
- **端到端驗收**（M2 起）：註冊 → 自帶範本價目表 → 複製 `/q/{slug}` → 無痕視窗完成報價 → 後台看到 awaiting_review → 調金額 → 確認 → 客戶信箱收到報價
