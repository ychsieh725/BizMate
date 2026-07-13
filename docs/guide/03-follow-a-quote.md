# 03 · 追蹤一筆報價：從客戶輸入到信箱收信

> 這一章用一筆具體的報價當主角，逐步看每支程式在什麼時機被呼叫、輸入輸出長什麼樣、資料庫多了哪些列。讀的時候建議把對應檔案開在旁邊。

登場人物：

- **商家**：小陳，slug 是 `chen-studio`，價目表裡「角色設計」單價 6000，「商業使用」加成 +40%
- **客戶**：阿華，拿到連結 `https://bizmate.example/q/chen-studio`

---

## 第 1 步：建立 session

阿華打開頁面、點選「插畫設計」。前端 [`wizardApi.ts`](../../src/app/q/[slug]/lib/wizardApi.ts) 的 `createSession()` 發出：

```
POST /api/sessions
{ "category": "illustration", "slug": "chen-studio" }
```

[`app/api/sessions/route.ts`](../../src/app/api/sessions/route.ts) 依序做：

1. **限流檢查（IP 桶）**：`sessions:ip:{阿華的IP}` 這小時內不能超過 10 次 → 超過直接回 `429`
2. **zod 驗證 body**：格式錯回 `400`
3. **限流檢查（slug 桶）**：`sessions:slug:chen-studio` 同樣 10 次/小時——防止小陳的連結被殭屍網路灌爆
4. **用 slug 查商家**：查無回 `404`。這一步是關鍵——匿名客戶就是靠 slug 找到「這筆資料屬於哪個商家」
5. 呼叫 `createSession(category, merchant.id)` → 在 `sessions` 表插入一列

回應（統一信封格式，`success/data/error` 三件套）：

```json
{ "success": true, "data": { "session_id": "cdc3eb89-...", "status": "created" }, "error": null }
```

**資料庫此刻**：`sessions` 多了一列，`status='created'`、`merchant_id=小陳的id`、`category='illustration'`。

---

## 第 2 步：描述需求 → AI 解析 → 出報價

阿華輸入描述並送出：

```
POST /api/sessions/cdc3eb89-.../describe
{
  "raw_text": "幫我畫 1 個角色設計，精緻上色，需要高解析度印刷檔，商業使用，三天內交件，含 2 次修改",
  "contact_email": "ahua@example.com"
}
```

route 驗完輸入後把工作交給 [`orchestrator/describeFlow.ts`](../../src/orchestrator/describeFlow.ts) 的 `handleDescribe()`。這支函式是很好的「編排層」範例，它自己不做任何一件實事，只負責按順序調度：

### 2a. 狀態機守門

```ts
const toParsing = transition(session.status, "describe_submitted");
if (!toParsing.ok) {
  return { ok: false, error: "conflict", currentStatus: session.status };
}
```

查 `TRANSITIONS.created.describe_submitted` → 得到 `"parsing"`，放行。如果阿華手快連按兩次送出，第二次請求進來時狀態已是 `parsing`，查表失敗 → API 回 `409`。

### 2b. 落地原文、推進狀態

- `raw_inputs` 表插入阿華的原文（之後商家在後台能看到客戶到底說了什麼）
- `sessions` 更新：`contact_email` 填入、`status` → `parsing`

### 2c. 呼叫 Gemini 解析 — [`parserAgent.ts`](../../src/domains/intake/parserAgent.ts)

組出的 prompt 大概長這樣：

```
案件類型：插畫設計
需要抽取的欄位：subtype、quantity、license_scope、...

客戶需求描述（待分析資料）：
幫我畫 1 個角色設計，精緻上色，需要高解析度印刷檔，商業使用，三天內交件，含 2 次修改
```

呼叫走 [`costLogger.ts`](../../src/domains/finops/costLogger.ts) 的 `generateStructuredAndLog()`——它包了兩件事：

1. **[`gemini/generate.ts`](../../src/lib/gemini/generate.ts) 的 `generateStructured()`**：把 zod schema 轉成 JSON Schema 傳給 Gemini（強制它回傳指定形狀的 JSON），拿到回應後**再用同一份 zod schema 驗證一次**（不信任 AI 的輸出）。失敗自動重試 1 次。
2. **記帳**：從回應的 `usageMetadata` 讀 token 數，乘上單價，寫進 `cost_logs` 表。寫入失敗只印 log 不中斷主流程（記帳壞掉不該擋住客戶拿報價）。

Gemini 回傳（已通過 zod 驗證）：

```json
{
  "fields": {
    "subtype":       { "value": "角色設計", "confidence": 0.95, "source_span": "角色設計" },
    "quantity":      { "value": "1",       "confidence": 0.9,  "source_span": "1 個" },
    "license_scope": { "value": "商業使用", "confidence": 0.92, "source_span": "商業使用" }
  }
}
```

注意分工：「缺不缺欄位」**不是 AI 說了算**——程式端拿信心門檻（`CONFIDENCE_THRESHOLD`）逐欄位檢查，低於門檻視同沒抽到。判斷邏輯必須可靠、可測，所以留在程式裡。

抽取結果 upsert 進 `extracted_fields` 表（商家後台的「抽取欄位」區塊資料來源，含 `source_span` 原文依據——這就是「AI 為什麼這樣填」的證據）。

### 2d. 分支決策 — [`resolveAfterParse.ts`](../../src/orchestrator/resolveAfterParse.ts)

```
缺欄位？
├─ 是，且反問還沒滿 3 輪 → 生成一句反問 → 狀態 awaiting_clarification（本章走不到這條）
├─ 是，但 3 輪用完      → 用現有資訊照算，報價標記 is_conservative=true（保守估算）
└─ 否（阿華這筆：齊全）  → 正常計價 ↓
```

### 2e. 計價 — [`basePricing.ts`](../../src/domains/pricing/basePricing.ts)

```
查 rate_card_base（merchant_id=小陳, category=illustration, subtype=角色設計）
  → 找到，單價 6000
基本費 = 6000 × 1 = 6000
查 rate_card_modifiers → 「商業使用 +0.4」觸發（授權範圍比對成功）
  → 加成 = 6000 × 0.4 = 2400
總計 8400
```

如果查不到「角色設計」這個子類（例如客戶要的東西小陳根本沒賣）→ 回 `outOfScope: true`，報價金額為 null，轉人工處理。

### 2f. 產生報價單

- `generateQuoteCode()` 取小陳的下一個流水號 → `I-2607001`（撞號會重試一次——兩個客戶同時送單可能拿到同號）
- `quotes` 表插入一列：`status='awaiting_review'`、`final_amount=8400`
- `price_line_items` 表插入兩列明細，各自帶 `rule_id`／`modifier_id` 指回價目表的規則
- `sessions.status` 依序推進 `parsing → pricing → awaiting_review`

### 2g. 回應給阿華的瀏覽器

```json
{ "success": true, "data": { "status": "awaiting_review", "quote_code": "I-2607001", "out_of_scope": false }, "error": null }
```

前端 `StepResult.tsx` 顯示「報價單編號 I-2607001，等待商家確認」，並開始每隔幾秒 `GET /status` 輪詢——等狀態變成 `confirmed`/`sent` 時更新畫面文字。

**資料庫此刻**：`sessions`(awaiting_review) + `raw_inputs`(1 列) + `extracted_fields`(N 列) + `quotes`(1 列) + `price_line_items`(2 列) + `cost_logs`(1 列)。

---

## 岔路：如果阿華只說「我想要一個 LOGO」

抽取結果會缺一堆欄位 → `resolveAfterParse` 走反問路徑：

1. `clarificationFields.ts` 依優先序挑一個最重要的缺漏欄位
2. `clarificationAgent.ts` 呼叫 Gemini 生成一句自然的中文反問（例如「請問 LOGO 需要用在哪些地方？個人或商業使用？」）
3. 寫入 `clarification_turns` 表、狀態轉 `awaiting_clarification`
4. API 回應帶著問題，前端顯示給阿華

阿華回答後前端打 `POST /answer` → [`answerFlow.ts`](../../src/orchestrator/answerFlow.ts) 把回答併進原文重新解析 → 又回到 `resolveAfterParse` 的同一個分支決策。最多循環 3 輪，用完就保守估算。

---

## 第 3 步：小陳在後台審核

小陳登入後台。每個 `/dashboard` 頁面與 API 的第一行都是：

```ts
const auth = await requireMerchant();   // lib/auth/requireMerchant.ts
```

它做三段檢查：cookie 裡有登入嗎（沒有→401）→ 這個使用者建過商家嗎（沒有→403）→ 都過了回傳 `merchantId`。**任何例外一律當 401 處理（fail-closed）**——寧可把合法使用者擋在外面，也不放未驗證的請求進來。

小陳打開這筆報價的詳情頁 `/dashboard/quotes/{報價的UUID}`（列表頁點「查看」進來；網址用的是資料庫主鍵，不是報價編號）。資料來自 [`quoteReviewService.ts`](../../src/domains/pricing/quoteReviewService.ts) 的 `getQuoteDetail(quoteId, merchantId)`——這支函式先驗證「這筆報價真的屬於小陳」，通過了才去撈明細、抽取欄位、反問歷程（為什麼要這樣設計，見 [04-patterns.md](04-patterns.md) 的租戶隔離）。

小陳覺得價格 OK，按下「確認報價」：

```
POST /api/dashboard/quotes/{id}/confirm
```

[`quoteActionsService.ts`](../../src/domains/pricing/quoteActionsService.ts) 的 `confirmQuote()`：

1. 歸屬檢查：報價是小陳的嗎？session 也是小陳的嗎？（兩個都查，因為它們是獨立的外鍵）
2. 狀態機檢查：`transition("awaiting_review", "quote_confirmed")` → `"confirmed"`，合法
3. 呼叫資料庫 RPC `advance_quote_status`——在**單一交易**裡同時把 `quotes.status` 和 `sessions.status` 推到 `confirmed`。為什麼要用 RPC？因為 Supabase 的 JS 客戶端沒有跨多條 SQL 的交易功能，兩張表要嘛一起成功要嘛一起失敗，只能把這段邏輯放進資料庫函式裡

---

## 第 4 步：寄出報價信

小陳按「寄送報價單」→ `POST /api/dashboard/quotes/{id}/send` → `sendQuoteEmail()`：

```
1. 歸屬 + 狀態機檢查（confirmed 才能寄）
2. renderQuoteEmail() 產生信件內容
     — 純函式：報價資料進、HTML+純文字出
     — 商家名稱、品項名稱都做過 HTML 跳脫（防止惡意內容注入信件）
3. 先呼叫 Resend 真的把信寄出去
4. 寄成功了，才呼叫 RPC 把狀態推進 sent（並寫入 sent_at 時間戳）
```

第 3、4 步的**順序是刻意的**：如果反過來（先改狀態再寄信），寄信失敗時狀態已是 `sent`，小陳會以為寄成功了但客戶什麼都沒收到。現在的順序下，寄信失敗 → 狀態留在 `confirmed` → 按鈕還在 → 再按一次就是重寄，天然支援重試。

阿華的信箱收到主旨含 `I-2607001` 的報價信，`reply-to` 設成小陳的 email——阿華直接回信就是回給小陳。

**最終狀態**：`sessions.status = quotes.status = 'sent'`（終態，狀態機沒有任何出邊，這筆流程結束）。

---

## 回顧：一張請求的完整分層

```
瀏覽器
  │ fetch
  ▼
route.ts            薄殼：zod 驗證輸入、包裝回應信封
  │
  ▼
orchestrator/       流程編排：查狀態機、按順序調度（只有客戶流程有這層）
domains/*Service    業務規則：歸屬檢查、狀態驗證、計價邏輯
  │
  ▼
domains/*Repository 資料存取：繼承 BaseRepository 的標準 CRUD
  │
  ▼
lib/supabase        基礎設施 → PostgreSQL
lib/gemini          基礎設施 → Gemini API
lib/email           基礎設施 → Resend API
```

每一層只跟下一層說話。看任何一支 API 都是同樣的形狀——熟悉一條路徑後，其他路徑都長一樣。

## 下一步

看 [04-patterns.md](04-patterns.md)，把這章看到的慣例（信封、守門、RPC、隔離）系統性整理一遍。
