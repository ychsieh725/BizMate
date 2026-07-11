# MT-M4a：報價列表 + 詳情（Design Spec）

- **WBS 任務**：5.6
- **日期**：2026-07-11
- **分支**：`feat/mt-m4a-quote-review`
- **依賴**：5.4 MT-M2c（`requireMerchant` 守門 + RLS owner policies + dashboard 骨架）
- **後續**：5.7 MT-M4b（調金額 + 確認）會直接建立在本任務的 service / API 之上

---

## 1. 目標與範圍

商家登入後台後，能看到「客戶透過 `/q/{slug}` 送進來的報價」清單，並點進單筆看到完整的可追溯脈絡（費用明細、抽取欄位、澄清歷程、原始描述）。

**本任務涵蓋**（唯讀）：

- `GET /api/dashboard/quotes?status=` — 報價列表
- `GET /api/dashboard/quotes/{id}` — 報價詳情（聚合四張子表）
- `/dashboard/quotes` — 列表頁（狀態篩選 tab）
- `/dashboard/quotes/{id}` — 詳情頁（唯讀）

**本任務不涵蓋**（留給 5.7 / 5.8）：

- 調整金額（`PATCH /api/dashboard/quotes/{id}`）
- 確認送出（`POST /api/dashboard/quotes/{id}/confirm`，走狀態機 `quote_confirmed` 事件）
- Email 寄送
- 分頁、排序切換、關鍵字搜尋（YAGNI — MVP 階段單一商家報價量小，先一次撈完）

---

## 2. 資料流與租戶隔離（核心不變式）

### 2.1 Schema 的歸屬結構

`0001_init.sql` 的多租戶原則：

| 表 | 歸屬方式 |
| :--- | :--- |
| `quotes` | **直接持有 `merchant_id`** |
| `sessions` | **直接持有 `merchant_id`** |
| `price_line_items` | 僅有 `session_id`（間接歸屬） |
| `extracted_fields` | 僅有 `session_id`（間接歸屬） |
| `clarification_turns` | 僅有 `session_id`（間接歸屬） |
| `raw_inputs` | 僅有 `session_id`（間接歸屬） |

repository 走 service_role client（繞過 RLS），因此**租戶隔離的主要保證在應用層**（RLS owner policies 是第二道防線）。

### 2.2 安全不變式

> **子表查詢只接受「已通過 quote 歸屬檢查」的 `session_id`，絕不接受外部傳入的 session_id。**

`getQuoteDetail(quoteId, merchantId)` 的執行順序不可調換：

```
1. quote = quoteReviewRepository.findDetailById(quoteId)   // quote + 其 session
2. quote === null                    → 回 null   （route 轉 404）
3. quote.merchant_id !== merchantId  → 回 null   （route 轉 404，不回 403：不洩漏資源存在性）
   ──────── 過了這道門，才准使用 quote.session_id ────────
4. 以 quote.session_id 平行查四張子表
5. 組成 QuoteDetail 回傳
```

第 3 步的 404（而非 403）沿用 5.5 `findOwnedService` 既有慣例。

### 2.3 列表查詢

`listQuotes(merchantId, status?)`：以 `merchant_id` 過濾 + 選填 `status` 過濾，join `sessions` 取 `category` / `contact_email`，依 `created_at` 新到舊排序。無 `status` → 回全部。

---

## 3. 檔案結構

### 新增

| 檔案 | 職責 |
| :--- | :--- |
| `src/domains/pricing/repositories/quoteReviewRepository.ts` | 後台唯讀查詢：`findAllByMerchant(merchantId, status?)`、`findDetailById(quoteId)`、子表查詢（`findLineItems` / `findExtractedFields` / `findClarifications` / `findRawInputs`，皆以 session_id 為參數） |
| `src/domains/pricing/quoteReviewService.ts` | 歸屬檢查 + 資料聚合的唯一入口：`listQuotes()`、`getQuoteDetail()` |
| `src/domains/pricing/quoteReviewSchemas.ts` | `quoteIdSchema`（UUID）、`listQuotesQuerySchema`（`status` 選填，值域為 `quote_status` enum） |
| `src/domains/pricing/quoteReviewTypes.ts` | `QuoteListRow`、`QuoteDetail` 型別 |
| `src/app/api/dashboard/quotes/route.ts` | `GET` 列表 |
| `src/app/api/dashboard/quotes/[id]/route.ts` | `GET` 詳情 |
| `src/app/dashboard/quotes/page.tsx` | 列表頁（Server Component + `searchParams` 篩選） |
| `src/app/dashboard/quotes/[id]/page.tsx` | 詳情頁（Server Component，唯讀） |
| `scripts/verify-quotes.ts` | 對真實 DB 的跨租戶隔離驗證 |

### 修改

- `src/app/dashboard/page.tsx` — 「待審報價 N 筆」改為連往 `/dashboard/quotes?status=awaiting_review`
- `src/shared/constants/routes.ts` — 補 `PAGE_ROUTES.quotes` / `quoteDetail(id)`、`API_ROUTES.dashboardQuotes` / `dashboardQuote(id)`

### 不動

`quotesRepository`（寫入 + 流水號計數）維持原樣。「報價寫入」與「後台審核查詢」是不同關注點，比照 5.5 `rateCardRepository`（計價查表）vs `servicesRepository`（後台 CRUD）的切分慣例。

---

## 4. API 契約

### `GET /api/dashboard/quotes?status={quote_status}`

| 情況 | 回應 |
| :--- | :--- |
| 未登入 | 401 `請先登入` |
| 已登入無 merchant | 403 `查無商家資料` |
| `status` 非合法 enum 值 | 400 |
| 成功 | 200 `{ items: QuoteListRow[] }` |

```ts
type QuoteListRow = {
  id: string;
  quote_code: string;
  final_amount: number | null;
  status: QuoteStatus;
  is_conservative: boolean;
  created_at: string;
  category: CaseCategory;        // 來自 sessions
  contact_email: string | null;  // 來自 sessions
};
```

### `GET /api/dashboard/quotes/{id}`

| 情況 | 回應 |
| :--- | :--- |
| 未登入 | 401 |
| 已登入無 merchant | 403 |
| `id` 非合法 UUID | 400 |
| quote 不存在 **或** 屬於其他商家 | 404 `找不到指定的報價` |
| 成功 | 200 `{ detail: QuoteDetail }` |

```ts
type QuoteDetail = {
  quote: Tables<"quotes">;
  session: Tables<"sessions">;
  lineItems: Tables<"price_line_items">[];
  extractedFields: Tables<"extracted_fields">[];
  clarifications: Tables<"clarification_turns">[];
  rawInputs: Tables<"raw_inputs">[];
};
```

---

## 5. UI 決策

### 列表頁 `/dashboard/quotes`

- 狀態篩選 tab：全部／待審／已確認／已寄出，以 `<Link href="?status=...">` 驅動 SSR 重查（可分享、可重整、無 client state）。
- 當前 tab 標示 `aria-current="page"`。
- 保守估算的列顯示 badge。
- 空列表顯示引導文案（尚無報價，把分享連結傳給客戶）。

### 詳情頁 `/dashboard/quotes/{id}`

唯讀區塊，由上而下：

1. **報價摘要** — 編號、分類、客戶 Email、金額、狀態、保守估算 badge、建立時間
2. **費用明細** — `item_name` / `amount` / `agent_reasoning` / `confidence`
3. **抽取欄位** — 以既有 `fieldLabel()` 轉中文標籤，顯示 value / confidence / source_span
4. **澄清歷程** — round / question / answer（依 round 遞增）
5. **原始描述** — 依 `created_at` 全部列出（不只最新一筆；後台需看到客戶說過的每一句）

### 停售項目的顯示

`price_line_items.rule_id` 可能指向已 `is_active=false` 的服務項目（5.5 軟刪除）。詳情頁**不 join 現價顯示**——報價是歷史快照，顯示當下算出的 `amount` 才是正確的；join 現價反而誤導商家以為報價金額變了。

---

## 6. 測試策略（TDD）

| 層級 | 測試項 |
| :--- | :--- |
| `quoteReviewService` | **跨租戶隔離：B 商家 merchantId 取 A 的 quote → 回 null，且四個子表查詢完全沒被呼叫**（安全不變式的直接驗證）；quote 不存在 → null；正常聚合形狀正確 |
| `GET /api/dashboard/quotes` | 401 / 403 / 400（status 非法值）/ 200；status 正確傳遞至 service |
| `GET /api/dashboard/quotes/[id]` | 401 / 403 / 400（id 非 UUID）/ 404（不存在、跨租戶）/ 200 |
| `scripts/verify-quotes.ts` | 對真實 DB：A/B 兩商家各有報價 → B 查 A 的 quote 得 404；B 的列表只回自己的列 |

跨租戶隔離是重構計畫 §127 對 M4 點名的必測項。

---

## 7. 風險

| 風險 | 緩解 |
| :--- | :--- |
| 子表無 `merchant_id`，繞過 service 直接以 session_id 查子表即破功 | 安全不變式寫進 `quoteReviewService` 註解；repository 的子表方法只給 service 使用；service 測試明確斷言「歸屬失敗時子表 mock 零呼叫」 |
| 報價量成長後列表一次撈完會變慢 | MVP 可接受；分頁留待實際遇到再加（YAGNI） |
