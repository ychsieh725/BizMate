# MT-M2b：Onboarding — 設計文件

**日期：** 2026-07-10
**對應 WBS：** 5.3 MT-M2b
**對應計畫：** `documents/BizMate_多租戶重構計畫_v1.0.md` §2、§4
**依賴：** 5.2 MT-M2a（已完成，併入 main）

## 背景與目標

多租戶重構計畫 M2 里程碑第二步。使用者註冊登入後（5.2 已完成），需要一個 onboarding 流程建立自己的 `merchants` 列並取得起始價目表，才能拿到 `/q/{slug}` 分享連結。目前 `merchants` 表已存在（0001_init.sql），`copyTemplateRateCard(merchantId)` 已存在（`src/domains/merchant/onboardingService.ts`），但建立 merchant 列本身（含 slug 生成）尚無實作。

## 關鍵限制（設計期間發現）

`merchants` 表已 `ENABLE ROW LEVEL SECURITY`，但**尚無任何 policy**（policy 建立是 5.4 的範圍）。deny-by-default 下，任何用 session-based（anon key）client 對 `merchants` 的查詢都會回空、寫入都會被拒。因此：

- onboarding API 建立/查詢 merchant，一律透過 `merchantsRepository`（繼承 `BaseRepository`，內部用 service_role client，天生繞過 RLS）。
- middleware 判斷「已登入但無 merchant」同樣透過 `merchantsRepository.findById(user.id)`（service_role），不受尚未建立的 RLS policy 影響。
- 身分驗證本身（「這個 request 是誰」）仍靠 session cookie 的 `supabase.auth.getUser()`（Auth API，不受 Postgres RLS 影響）；merchant 存在性查詢則是對「已驗證身分」信任的 service_role 查詢，用該身分自己的 id 查自己的資料，不構成跨租戶風險。
- 5.4 補上 RLS owner policies 後，此資料流不需改動（service_role 本就繞過 RLS，policy 是給屆時新增的 session-based 查詢用）。

## 範圍邊界

**包含：**
- `POST /api/dashboard/onboarding`（冪等）：建立 merchant + 複製範本價目表
- slug 自動生成演算法 + 碰撞重試
- `/onboarding` 頁面（表單：僅 `display_name`）
- middleware（`src/proxy.ts`）擴充：「已登入但無 merchant」導向 `/onboarding`；「已登入且有 merchant」訪問 `/onboarding` 導回 `/dashboard`

**明確不含**（留給 5.4）：
- `requireMerchant` 守門抽象（本任務 API 內直接用 `auth.getUser()` 做最簡單的登入檢查）
- RLS owner policies

## 架構

```
src/domains/merchant/slugGenerator.ts      純函式：email 前綴清洗、隨機詞組、候選 slug 產生器
src/domains/merchant/onboardingService.ts  新增 onboardMerchant()（既有 copyTemplateRateCard 不動）
src/app/api/dashboard/onboarding/route.ts  POST，route+service 薄分層（同 /api/sessions 慣例）
src/app/onboarding/OnboardingForm.tsx      Client Component：display_name 輸入 + fetch 提交
src/app/onboarding/page.tsx                Server Component 外殼
src/lib/auth/redirectDecision.ts           擴充：加入 hasMerchant 參數
src/proxy.ts                               擴充：/dashboard、/onboarding 時查 merchant 是否存在
```

`/api/dashboard/onboarding` 用真實 REST route（非 Server Action），對齊多租戶計畫文件 §3 列出的其餘 dashboard API 皆為 REST route 的慣例（有別於 5.2 認證頁使用 Server Action 的特例）。

## 資料流

### slug 生成
1. 清洗 email 前綴：轉小寫、只保留 `[a-z0-9]`（其餘字元含大寫、中文、`+`、`.`、`_` 一律去除）
2. 清洗後長度 < 3 → 改用隨機形容詞-名詞-4 位數字組合（如 `swift-fox-4821`）當基底
3. 用 `merchantsRepository.findBySlug` 查是否已被使用：
   - 未被使用 → 採用
   - 已被使用 → 加 3 位隨機數字後綴重試（如 `abc-482`），最多重試 5 次
   - 5 次仍碰撞 → 改用完全隨機形容詞-名詞-4 位數字組合，最多再重試 5 次
   - 總計 10 次仍碰撞（機率上不可能：隨機空間遠大於商家數量）→ 拋出例外，由 API 層轉為 500

### onboardMerchant(userId, email, displayName)
1. `merchantsRepository.findById(userId)` — 存在就直接回傳該筆（**真冪等**：不覆蓋 `display_name`、不重複呼叫範本複製）
2. 不存在 → 依上述演算法產生唯一 slug → `merchantsRepository.create({ id: userId, display_name, public_slug, contact_email: email })`
3. 呼叫既有 `copyTemplateRateCard(userId)`（其內部本身也冪等，此處為保險呼叫）
4. 回傳 `{ merchant, created: boolean }`

### API：POST /api/dashboard/onboarding
1. 用 `serverClient.createClient()` 取得 session，`auth.getUser()` 查無使用者 → 401
2. 解析 body：`display_name` 為必填非空字串，否則 400
3. 呼叫 `onboardMerchant(user.id, user.email, display_name)`
4. 回傳 `apiOk({ merchant }, created ? 201 : 200)`：新建回 201，已存在（冪等命中）回 200

### middleware
`getUserAndResponse` 判斷已登入後，若目標路徑落在 `/dashboard` 或 `/onboarding` 前綴，額外呼叫 `merchantsRepository.findById(user.id)` 取得 `hasMerchant`，交給擴充後的 `decideRedirect(pathname, isAuthenticated, hasMerchant)`：

| 狀態 | 路徑 | 結果 |
|---|---|---|
| 未登入 | `/dashboard`、`/onboarding` | → `/login`（既有邏輯不變） |
| 已登入、無 merchant | `/dashboard` | → `/onboarding` |
| 已登入、無 merchant | `/onboarding` | 放行（正確目的地） |
| 已登入、有 merchant | `/onboarding` | → `/dashboard`（避免重複 onboarding） |
| 已登入、有 merchant | `/dashboard` | 放行 |
| 已登入 | `/login`、`/signup` | 依有無 merchant 分別導向 `/dashboard` 或 `/onboarding` |

## 錯誤處理

- 未登入呼叫 API → 401
- `display_name` 空白 → 400
- 其餘例外（含理論上的 DB 唯一鍵競態）→ 500 通用訊息，同 `/api/sessions` 既有慣例，不做複雜重試（機率極低，MVP 不值得增加複雜度）

## 測試

- `slugGenerator.ts`：純函式 TDD，涵蓋清洗、fallback、碰撞重試（用假的 `isTaken` callback 隔離 DB，不需真實連線）
- `onboardMerchant`：mock `merchantsRepository`，測試冪等分支（已存在）與新建分支（含呼叫 slug 產生、`copyTemplateRateCard`）
- `redirectDecision.ts`：擴充既有測試涵蓋新的 `hasMerchant` 參數與上表六種狀態
- `route.ts`：比照 `/api/sessions/route.test.ts` 風格，mock service 層
- UI（`OnboardingForm.tsx`、`page.tsx`）依專案慣例不寫 vitest 單元測試，留待手動瀏覽器驗證（同 5.2 慣例）
