# BizMate Rate Limiting 技術選型決策記錄（ADR）

- **版本**：v0.1
- **日期**：2026-07-05
- **對應任務**：3.7 輸入驗證 + rate limiting
- **對應需求**：NFR-7（濫用防護）、SDS §13.3（公開端點濫用防護）
- **狀態**：已決定 —— 採 **Supabase durable 表 + 固定視窗原子計數**

---

## 1. 背景與問題

`/api/sessions` 系列端點是**完全公開、免驗證**的：任何人都能提交報價請求。
這帶來兩個具體風險：

1. **耗盡 Gemini 免費層額度** —— 每次 `/describe` 會呼叫 Gemini，被灌爆等於燒光額度、正常使用者無法報價。
2. **DB 灌爆** —— 無上限地建立 session / 寫入 raw_inputs。

NFR-7 明確要求：**公開的 session 建立端點須有 rate limiting（同一 IP 每小時上限）**。

### 1.1 真正的技術限制：Serverless 無共享狀態

BizMate 部署在 **Vercel Serverless**。限流的本質是「跨請求累計計數」，但 Serverless 有兩個特性讓這件事變難：

- **多實例不共享記憶體** —— 同一時間的並發請求可能落在不同 lambda 實例，各自的記憶體彼此看不到。
- **冷啟即清空** —— 實例回收後記憶體歸零，計數也跟著消失。

因此，**限流狀態必須落在 durable、跨實例共享的 store**，否則形同虛設。這是整個選型的核心約束。

---

## 2. 評估的選項

| 選項 | 跨實例共享 | 冷啟存活 | 新依賴 | 可測性 | migration |
| :--- | :---: | :---: | :---: | :---: | :---: |
| A. 記憶體固定視窗 | ❌ | ❌ | 無 | 高 | 無 |
| **B. Supabase durable 表** ✅ | ✅ | ✅ | 無 | 高 | 需一支 |
| C. Upstash Redis | ✅ | ✅ | 有 | 中 | 無 |
| D. Vercel WAF / Firewall | ✅ | ✅ | 平台設定 | 低 | 無 |

### 選項 A：記憶體固定視窗（Map 計數）

在 lib helper 或 Next.js middleware 內用 `Map` 記錄 `ip → count`。

- **優點**：零依賴、零 migration、限流器可寫成純函式單元測試、無額外 I/O 延遲。
- **致命缺點**：如 §1.1，Serverless 多實例不共享 + 冷啟清空 → 攻擊者只要打到不同實例就繞過。**只能擋單一實例的洪水，對真實濫用幾乎無效**。
- **結論**：只適合 demo 階段「聊勝於無」的防護，不符合 NFR-7 的實質要求。

### 選項 B：Supabase durable 表（最終選擇）✅

在 Postgres 建 `rate_limits` 表，以固定視窗計數；用 Postgres function 做原子的「計數 + 上限判斷」。

- **優點**：
  - **真正有效** —— durable、跨所有 Serverless 實例共享、冷啟不失效。
  - **零新依賴** —— 用專案既有的 Supabase，不引入外部服務、不增加帳號與環境變數管理成本。
  - **符合 SDS §13.3 明示** ——「Vercel 或 Supabase 皆有現成的 middleware 可用」。
  - **可測** —— 限流邏輯（IP 取值、視窗對齊、結果對映、fail-open）以 mock RPC 單元測試；真實原子行為以 verify script 對真實 DB 驗收。
- **代價**：
  - 需要一支 migration（新表 + RPC function）。
  - 每次 `POST /sessions` 多一次 DB round-trip（可接受：本來就要寫 DB 建 session）。
- **結論**：在「正確性」與「不增加架構複雜度」之間的最佳平衡點。

### 選項 C：Upstash Redis

Serverless 限流的業界標準方案（`@upstash/ratelimit`），跨實例準確、低延遲。

- **優點**：專為 Serverless 限流設計、滑動視窗等演算法現成、效能佳。
- **缺點**：**引入外部服務與新依賴** —— 需額外帳號、環境變數、lock file 維護；多一個可能故障的元件。SDS 未要求到這個程度。
- **結論**：對目前 MVP 過重。若未來限流需求變複雜（多端點、滑動視窗、分散式高並發），可再評估遷移。

### 選項 D：Vercel WAF / Firewall

在 Vercel 平台層設定限流規則，不寫程式碼。

- **優點**：完全不碰應用程式碼、平台級防護。
- **缺點**：屬**平台設定而非程式碼**，無法版本控制、無法單元測試、無法隨 repo 一起交付；且細緻的「每 IP 每小時 N 次」規則多屬付費方案。
- **結論**：可作為未來的**額外一層**（縱深防禦），但不作為 P0 的主要手段。

---

## 3. 最終決策

**採選項 B：Supabase durable 表 + 固定視窗原子計數。**

一句話理由：**在唯一能真正生效的方案中（B/C/D），B 是唯一「零新依賴、可版本控制、可測、且用現有基礎設施」的選擇**；A 雖最簡但在 Serverless 下實質無效，不予採用。

---

## 4. 實作要點

### 4.1 資料結構（`rate_limits` 表）

```
bucket_key   TEXT         -- 例："sessions:1.2.3.4"（端點 + IP）
window_start TIMESTAMPTZ  -- 視窗起點（呼叫端對齊整點）
count        INTEGER      -- 該視窗累計請求數
PRIMARY KEY (bucket_key, window_start)
```

一列 = 某 bucket 在某視窗的請求數。以複合主鍵天然去重。

### 4.2 演算法：固定視窗（Fixed Window）

- 呼叫端把 `now` 對齊到 `windowMs` 邊界得 `window_start`（`floor(now / windowMs) * windowMs`）。
- 對「基本防護」足夠；不採成本更高的滑動視窗（sliding window）。
- 已知取捨：視窗邊界處可能出現短時突發（最壞 2 倍上限），對本場景可接受。

### 4.3 原子性：單一 upsert 完成「計數 + 判斷」

`increment_rate_limit(bucket_key, window_start, limit)` RPC 以一條 SQL 避免 read-then-write 競態：

```sql
INSERT INTO rate_limits (bucket_key, window_start, count)
VALUES (p_bucket_key, p_window_start, 1)
ON CONFLICT (bucket_key, window_start)
DO UPDATE SET count = rate_limits.count + 1
  WHERE rate_limits.count < p_limit   -- 達上限即不更新
RETURNING count;
```

- 回傳非 NULL（成功計入）→ **允許**。
- 回傳 NULL（`WHERE` 未通過、未更新）→ **已達上限，拒絕（429）**。
- 前 `limit` 次允許、第 `limit+1` 次擋下，邊界精確。

### 4.4 Fail-open（可用性優先）

RPC 錯誤或例外時**放行並記錄**，而非擋下。理由：限流是防濫用的**附屬**機制，不應因限流層本身故障，導致正常使用者全被擋、整站不可用。安全性與可用性的取捨在此明確倒向可用性。

### 4.5 參數

| 端點 | 規則 |
| :--- | :--- |
| `POST /api/sessions` | 同一 IP 每小時 10 次 |

IP 來源：Vercel 代理標頭 `x-forwarded-for` 的第一段；取不到回 `"unknown"`。

---

## 5. 已知限制與未來演進

- **舊視窗列累積**：`rate_limits` 會累積過期視窗的列。對計數正確性無影響；未來可用排程（`pg_cron`）清理。
- **`"unknown"` 共用 bucket**：取不到 IP 的請求會共用同一 bucket，可能誤傷。可接受（正常 Vercel 環境都有 `x-forwarded-for`）。
- **固定視窗突發**：如 §4.2，邊界突發最壞 2 倍。若未來需要更平滑，遷移選項 C（Upstash 滑動視窗）。
- **縱深防禦**：未來可疊加選項 D（Vercel WAF）作為平台層的額外一道防線。

---

## 6. 對應交付物

| 檔案 | 說明 |
| :--- | :--- |
| `supabase/migrations/0003_rate_limits.sql` | `rate_limits` 表 + `increment_rate_limit` RPC |
| `src/lib/rateLimit/rateLimit.ts` | 限流核心（IP 取值、視窗對齊、原子檢查、fail-open） |
| `src/lib/rateLimit/rateLimit.test.ts` | 單元測試（mock RPC） |
| `src/app/api/sessions/route.ts` | 套用限流閘（超限回 429） |
| `scripts/verify-rate-limit.ts` | 對真實 Supabase 驗收原子計數行為 |
