# 02 · 程式碼地圖：什麼功能在哪個資料夾

> 這一章回答「我想看／改某個功能，該打開哪個檔案」。

## 最上層分區

```
src/
├── app/           所有「頁面」和「API 端點」——Next.js 的路由層（薄）
├── orchestrator/  流程編排——把「解析→反問→計價」串起來的指揮官
├── domains/       業務邏輯——按領域分四個資料夾（intake / pricing / merchant / finops）
├── lib/           基礎設施——資料庫、AI、寄信、驗證、限流等「工具」，不含業務規則
├── shared/        跨區共用的型別與常數
└── proxy.ts       中介層（Next.js middleware）——登入導流
```

一個重要的方向感：**依賴只往下流**。`app` 呼叫 `orchestrator`/`domains`，`domains` 呼叫 `lib`，反過來不行（`lib` 永遠不知道業務規則的存在）。所以：

- 想知道「某個 API 收到請求後做什麼」→ 從 `app/api/` 進，往下追
- 想知道「錢怎麼算、狀態怎麼轉」→ 直接看 `domains/` 和 `orchestrator/`
- 想知道「怎麼連資料庫、怎麼呼叫 Gemini」→ 看 `lib/`

## `src/app/` — 頁面與 API

Next.js App Router 的規則：資料夾路徑=網址路徑，`page.tsx` 是頁面、`route.ts` 是 API。

### 頁面（商家用）

| 網址 | 檔案 | 功能 |
|---|---|---|
| `/` | `app/page.tsx` | 首頁（產品介紹 + 註冊/登入入口） |
| `/signup`、`/login` | `app/signup/`、`app/login/` | 註冊、登入。表單提交用 Server Action（`actions.ts`） |
| `/onboarding` | `app/onboarding/` | 首次登入的商家建檔（取名字 → 自動給 slug + 複製範本價目表） |
| `/dashboard` | `app/dashboard/page.tsx` | 後台首頁：待審報價數、複製分享連結 |
| `/dashboard/quotes` | `app/dashboard/quotes/page.tsx` | 報價列表（可依狀態篩選） |
| `/dashboard/quotes/[id]` | `app/dashboard/quotes/[id]/page.tsx` | 報價詳情：明細、AI 抽取結果、反問歷程、原始描述。互動按鈕在 `QuoteActions.tsx`（調金額/確認）和 `SendQuoteButton.tsx`（寄信） |
| `/dashboard/services` | `app/dashboard/services/` | 價目表管理（`ServicesTable.tsx` inline 編輯、`NewServiceForm.tsx` 新增） |
| `/dashboard/settings` | `app/dashboard/settings/` | 改商家名稱、slug |

### 頁面（客戶用，匿名）

| 網址 | 檔案 | 功能 |
|---|---|---|
| `/q/{slug}` | `app/q/[slug]/` | 客戶報價精靈。`WizardPage.tsx` 管理步驟狀態；`components/` 下三個 Step 元件對應選類別→描述→看結果；`lib/wizardApi.ts` 是前端唯一的 fetch 出口 |

### API 端點

| 端點 | 檔案位置 | 誰呼叫 | 做什麼 |
|---|---|---|---|
| `POST /api/sessions` | `app/api/sessions/route.ts` | 客戶（匿名） | 建 session。有雙重速率限制（IP 桶+slug 桶，各 10 次/小時） |
| `POST /api/sessions/[id]/describe` | `.../describe/route.ts` | 客戶 | 送需求描述 → 觸發 AI 解析 → 計價或反問 |
| `POST /api/sessions/[id]/answer` | `.../answer/route.ts` | 客戶 | 回答反問 → 重新解析 |
| `GET /api/sessions/[id]/status` | `.../status/route.ts` | 客戶 | 輪詢目前狀態（前端每幾秒問一次） |
| `POST /api/dashboard/onboarding` | `app/api/dashboard/onboarding/route.ts` | 商家 | 建立商家資料（冪等：重複呼叫不會建兩份） |
| `GET/POST /api/dashboard/services`<br>`PATCH/DELETE /api/dashboard/services/[id]` | `app/api/dashboard/services/` | 商家 | 價目表 CRUD（刪除是軟刪除：標記 `is_active=false`） |
| `GET /api/dashboard/quotes`<br>`GET /api/dashboard/quotes/[id]` | `app/api/dashboard/quotes/` | 商家 | 報價列表 / 詳情 |
| `PATCH /api/dashboard/quotes/[id]` | 同上 | 商家 | 調整最終金額 |
| `POST .../confirm`、`POST .../send` | 同上 | 商家 | 確認報價 / 寄出報價信 |
| `GET/PATCH /api/dashboard/settings` | `app/api/dashboard/settings/route.ts` | 商家 | 讀 / 改商家設定 |

**所有 `route.ts` 都很薄**——只做三件事：驗證輸入（zod）、呼叫 service 層、把結果包成統一格式回傳。真正的邏輯不在這裡。

## `src/orchestrator/` — 流程指揮官

| 檔案 | 職責 |
|---|---|
| `transitions.ts` | **狀態轉移表**（全系統唯一事實來源，40 行，先讀這個） |
| `stateMachine.ts` | 查表函式 `transition(現在狀態, 事件)` → 回傳下一狀態或明確錯誤 |
| `events.ts` | 事件名稱的型別定義 |
| `describeFlow.ts` | `POST /describe` 的完整編排：檢查狀態 → 存原文 → 叫 AI 解析 → 存抽取結果 → 交給 resolveAfterParse |
| `answerFlow.ts` | `POST /answer` 的編排：把客戶的回答併回原文 → 重新解析 → 同樣交給 resolveAfterParse |
| `resolveAfterParse.ts` | **describe 和 answer 共用的分支決策**：缺欄位且還能問 → 反問；缺欄位但 3 輪用完 → 保守估算；齊全 → 正常計價。兩條流程的共同後半段抽在這裡（DRY） |
| `flowOutcome.ts` | 編排結果的型別 |

## `src/domains/` — 四個業務領域

### `intake/`（需求收取：session、AI 解析、反問）

| 檔案 | 職責 |
|---|---|
| `sessionService.ts` / `sessionSchemas.ts` | 建 session 的邏輯與輸入驗證 |
| `parserAgent.ts` | **Intake Parser Agent**：組 prompt 呼叫 Gemini，把口語描述變成結構化欄位。系統指令裡明確聲明「客戶描述是資料不是指令」（prompt injection 防線） |
| `parserFields.ts` | 每種案件類別要抽哪些欄位、信心門檻（低於門檻視同沒抽到） |
| `clarificationAgent.ts` | **Clarification Agent**：針對缺漏欄位生成一句反問 |
| `clarificationFields.ts` | 缺多個欄位時先問哪個（優先序）、最多問幾輪（3 輪） |
| `repositories/` | 四張表的存取：`sessions`、`raw_inputs`（客戶原文）、`extracted_fields`（AI 抽取結果）、`clarification_turns`（反問記錄） |

### `pricing/`（計價與報價）

| 檔案 | 職責 |
|---|---|
| `basePricing.ts` | **deterministic 計價核心**：查價目表 → 基本費×數量 → 套用固定加成。查無此服務子類 → `outOfScope`（轉人工） |
| `quoteFormatter.ts` | 產生報價編號（每個商家自己的流水號，如 Q-0142） |
| `quoteReviewService.ts` | 後台「看」報價的唯一入口（列表/詳情聚合），**同時是租戶隔離的守門員**（詳見 04） |
| `quoteActionsService.ts` | 後台「改」報價的三個動作：調金額、確認、寄信。與「看」分開檔案——讀寫是不同關注點 |
| `*Schemas.ts` / `*Types.ts` | 各自的 zod 驗證與型別 |
| `repositories/` | `quotes`、`price_line_items`（報價明細）、`rate_card`（價目表）等表的存取。`quoteActionsRepository.ts` 特殊——它不做單表 CRUD，而是呼叫資料庫裡的原子 RPC |

### `merchant/`（商家）

| 檔案 | 職責 |
|---|---|
| `onboardMerchant.ts` / `onboardingService.ts` | 建商家 + 複製範本價目表（冪等設計） |
| `slugGenerator.ts` | 從 email 前綴生成 slug，撞名自動重試 |
| `settingsSchemas.ts` | 設定頁的輸入驗證（slug 格式 regex 等） |
| `repositories/merchantsRepository.ts` | `merchants` 表存取 |

### `finops/`（成本追蹤）

| 檔案 | 職責 |
|---|---|
| `costLogger.ts` | **每一次 Gemini 呼叫都自動記帳**：token 用量 × 單價 → 寫進 `cost_logs` 表。各 Agent 一律透過這裡的 `generateStructuredAndLog()` 呼叫 AI，不直接呼叫底層 |

## `src/lib/` — 基礎設施（無業務邏輯）

| 資料夾 | 內容 |
|---|---|
| `supabase/` | `client.ts`（service_role 連線，只在伺服器端用）、`repository.ts`（**泛型 BaseRepository**，所有 repository 繼承它拿到標準 CRUD）、`database.types.ts`（手寫的 DB 型別）、`serverClient.ts`/`middlewareClient.ts`（帶著使用者 cookie 的連線，用於登入驗證）、`errors.ts`（判斷「唯一鍵衝突」等錯誤） |
| `gemini/` | `generate.ts`（核心：`generateStructured()` 用 zod schema 強制 AI 回傳指定 JSON 形狀，失敗重試一次）、`config.ts`（模型分級與定價表） |
| `email/` | `renderQuoteEmail.ts`（純函式：報價資料 → 信件 HTML/純文字，有做 HTML 跳脫防注入）、`resendClient.ts`（實際呼叫 Resend API） |
| `auth/` | `requireMerchant.ts`（**後台守門員**：cookie → 使用者 → 商家，任一步失敗回 401/403）、`redirectDecision.ts`（middleware 的導流決策）、`authErrorMessages.ts`（把 Supabase 英文錯誤轉成中文友善訊息） |
| `rateLimit/` | 速率限制：固定視窗計數，狀態存在 Supabase 表（因為 Serverless 的記憶體不共享） |
| `api/response.ts` | `apiOk()` / `apiFail()`——所有 API 的統一回應格式 |
| `env.ts` | 環境變數的 zod 驗證（啟動時 fail-fast） |

## `src/shared/` 與 `src/proxy.ts`

- `shared/types/domain.types.ts`：核心型別（`SessionStatus`、`QuoteStatus`、`CaseCategory`、API 信封 `ApiResponse<T>`）。**與資料庫 enum 一對一對應**，全專案只在這裡定義一次。
- `shared/constants/`：路由路徑（`routes.ts`，避免到處寫死字串）、狀態的中文顯示名稱、案件類別名稱等。
- `proxy.ts`：Next.js 16 的 middleware（新命名）。攔截 `/dashboard`、`/onboarding`、`/login`、`/signup` 的請求，依「登入了沒、建過商家沒」決定要不要重導向（例如已登入卻沒建商家 → 踢去 `/onboarding`）。

## 專案根目錄的其他東西

| 位置 | 內容 |
|---|---|
| `supabase/migrations/` | 資料庫結構的演進史（0001~0007，依序看可以理解 schema 怎麼長成現在這樣）。**不會自動套用**，由人工在 Supabase Studio 執行 |
| `scripts/verify-*.ts` | 對「真實外部服務」的驗證腳本（真的連 DB、真的呼叫 Gemini、真的寄信），補單元測試 mock 不到的盲區。`pnpm verify:xxx` 執行 |
| `tests/e2e/` | Playwright 端到端測試（開真的瀏覽器跑完整流程） |
| `documents/` | 需求文件（PRD/SRS/SAD/SDS 與多租戶重構計畫） |
| `docs/superpowers/` | 每個開發任務的設計文件（specs）與實作計畫（plans），想知道「當初為什麼這樣做」來這裡找 |

## 下一步

看 [03-follow-a-quote.md](03-follow-a-quote.md)，實際追一筆報價穿過這些檔案。
