# Tool-Calling Agent 與 Trajectory Eval — 設計文件

**日期：** 2026-08-15
**分支：** `feat/tool-calling-agent`
**基準：** main @ 8083a23
**依賴：** WBS 6.x（Intake/Clarification/Pricing 已完成）、WBS 7.x（Eval 基礎建設已完成）

---

## 背景與目標

現行系統的 LLM 使用方式是**單次結構化輸出**：[`generate.ts`](../../../src/lib/gemini/generate.ts) 只支援 one-shot `generateContent` + `responseJsonSchema`，模型不參與流程規劃。「下一步做什麼」100% 寫死在兩個地方：

- [`transitions.ts`](../../../src/orchestrator/transitions.ts) 的狀態轉移表（跨狀態）
- [`resolveAfterParse.ts`](../../../src/orchestrator/resolveAfterParse.ts) 的 if/else（狀態內：續問 vs 出價）

這個設計在可靠度上是對的，但造成三個具體的產品限制：

| 限制 | 現況 | 後果 |
| :--- | :--- | :--- |
| 反問只能批次全問 | `orderMissingFields` 把所有缺漏欄位包成一輪 | 客戶被迫回答可能不必要的題目 |
| rate card 只能事前查 | `allowedSubtypes` 在 parse 前查好硬塞（[`describeFlow.ts:55`](../../../src/orchestrator/describeFlow.ts#L55)） | 客戶需求不在 rate card 內時只能 `outOfScope` 退人工，無法追問「比較接近 A 還是 B」 |
| 無決策軌跡 | 只有 `price_line_items.agent_reasoning` 的單點理由 | 商家看到怪金額時無法回溯 AI 的推理路徑 |

**目標**：在**不動狀態機、不動計價確定性**的前提下，把 `parsing` 狀態內的決策交給一個有預算上限的 tool-calling agent，並建立能量測其行為軌跡的 trajectory eval。

### 非目標（明確不做）

- **不做**多 agent handoff（agent 之間互相交接）
- **不做** RAG / 向量檢索
- **不做** MCP server 封裝（可能的後續任務）
- **不改**任何既有狀態轉移語意（`transitions.ts` 一行都不動）
- **不改**客戶端 wizard 的 4 步結構

---

## 三條不變式（設計的地基）

這三條是本次改動的**驗收底線**，任何實作不得違反：

> **I-1｜金額不經過 LLM。**
> `compute_quote` 是一個 tool，但它內部呼叫 [`computeBasePricing`](../../../src/domains/pricing/basePricing.ts)，是純查表。agent 不能傳金額進來，也拿不到「調整金額」的手段。

> **I-2｜缺漏判定不經過 LLM。**
> 「哪些必要欄位還缺」由 `isFieldMissing`（confidence 門檻）deterministic 算出，作為 tool 的**回傳值**餵給 agent，而非讓 agent 自己宣稱。沿用 [`parserAgent.ts:64`](../../../src/domains/intake/parserAgent.ts#L64) 既有邏輯。

> **I-3｜agent 失控必須退回現行路徑。**
> 預算用盡、偵測到迴圈、tool 連續失敗 → fallback 到現有的 `resolveAfterParse`，產出與今天完全一致的結果。**agent 是加值層，不是必經路徑。**

I-3 是 `Never break userspace` 的具體落實：新路徑壞掉時，系統退化成今天的行為，而不是壞掉。

---

## 範圍邊界

**包含：**

- `src/lib/gemini/generateWithTools.ts`：多輪 tool-calling 呼叫層（新增，不改既有 `generate.ts`）
- `src/orchestrator/agent/`：tool 定義、executor、loop、budget 與終止條件
- `supabase/migrations/0009_agent_steps.sql`：軌跡表
- `src/domains/finops/` 擴充：step 級成本歸因（沿用 `cost_logs`，新增關聯）
- Trajectory eval：新增 4 項指標、golden set 標註擴充
- Feature flag `AGENT_LOOP_ENABLED`：新舊路徑並存
- 商家後台「AI 決策軌跡」區塊

**明確不含：**

- 客戶端 wizard 元件改動（`StepClarify` 的資料形狀不變）
- `transitions.ts`、`stateMachine.ts`、`events.ts` 的任何改動
- `computeBasePricing` 的任何改動
- Email 寄送流程

---

## 技術路線

### 為什麼不用 LangChain / LlamaIndex

專案是純 TypeScript + `@google/genai`，agent loop 的本質是「一個 while 迴圈 + tool dispatch table」，約 150 行。引入框架會帶來：不透明的 prompt 組裝（與既有 prompt injection 防線衝突）、難以精確歸因的 token 計數（破壞 `cost_logs` 的完整性）、額外的相依風險。**自行實作 loop，可控性與可測性都更高**，且對面試場景而言，能講清楚 loop 內部機制比會用框架更有價值。

### 為什麼另開 `generateWithTools.ts` 而非改 `generate.ts`

`generateStructured` 目前被 `parserAgent` 與 `clarificationAgent` 使用，且是 eval 基準線的量測對象。改它會同時動到「對照組」與「實驗組」，導致改動前後的指標無法比較。**新舊並存，才能做 A/B 對照**——而那份對照表正是這次改動最有價值的產出。

### Tool 設計原則：讓 agent 決定「問什麼」，不讓它決定「算什麼」

四個 tool 分成兩類：

- **查詢類**（可重複呼叫）：`lookup_rate_card`、`record_fields`
- **終止類**（呼叫即結束 loop）：`ask_customer`、`compute_quote`

agent 的自主性落在：要不要先查 rate card、抽完後選擇問還是算、問哪幾題、問的順序。
agent 拿不到的權力：判定欄位齊全與否（I-2）、決定金額（I-1）、跨狀態轉移。

---

## 架構

```
src/lib/gemini/
  generate.ts            （不動）one-shot structured output
  generateWithTools.ts   （新）多輪 tool-calling，回傳每一步的 usage/latency
  toolTypes.ts           （新）ToolDefinition / ToolCall / ToolResult 型別

src/orchestrator/agent/
  tools/
    lookupRateCard.ts    查詢 tool：該商家 active subtype 與欄位值域
    recordFields.ts      查詢 tool：驗證+寫入抽取欄位，回傳 deterministic 缺漏清單
    askCustomer.ts       終止 tool：寫 clarification_turns
    computeQuote.ts      終止 tool：跑 computeBasePricing + 開報價
  toolRegistry.ts        tool 名稱 → { schema, executor } 的查表（無 switch）
  agentLoop.ts           loop 本體：budget、終止條件、迴圈偵測、fallback
  agentBudget.ts         預算常數與耗盡判定
  agentTrace.ts          每步寫入 agent_steps（best-effort，不中斷主流程）

src/domains/eval/
  trajectoryMetrics.ts   （新）4 項軌跡指標
  goldenCases.*.ts       （擴充）每則加 expectedToolSequence 標註
```

`resolveAfterParse.ts` 保留不動，作為 fallback 路徑（I-3）。
`describeFlow.ts` / `answerFlow.ts` 依 feature flag 二選一分派。

---

## Tool 介面定義

### 1. `lookup_rate_card`（查詢，可重複）

```ts
輸入：{ category: CaseCategory }
輸出：{
  subtypes: string[];              // 該商家 active 的服務項目
  field_options: Record<string, string[] | null>;  // 各欄位的合法值域
}
```

無 LLM，純呼叫 `rateCardRepository.findActiveSubtypes`。
**存在理由**：讓 agent 在抽取前後都能查值域，取代現行「事前硬塞 `allowedSubtypes`」的做法。這是「客戶要的東西我們沒有」情境能被追問的前提。

### 2. `record_fields`（查詢，可重複）

```ts
輸入：{ fields: Record<string, { value, confidence, source_span }> }
輸出：{
  accepted: string[];
  rejected: Array<{ field: string; reason: string }>;  // 不在白名單/值域外
  still_missing: string[];         // ← deterministic 算出（I-2）
}
```

程式端做三件事：白名單過濾（拒絕自創欄位）、值域檢查、`upsertMany` 寫入 `extracted_fields`，然後用 `isFieldMissing` 算出 `still_missing` 回給 agent。

**這是整個設計最關鍵的一個 tool**：agent 得知「還缺什麼」的唯一管道是程式端的 deterministic 判定，它無法自行宣稱「都齊了」。

### 3. `ask_customer`（終止）

```ts
輸入：{ questions: Array<{ target_field: string; question: string }> }
輸出：（終止，不回 agent）
```

程式端驗證每個 `target_field` 必為 `still_missing` 的成員（沿用現行「target_field 必為缺漏清單成員」的不變式），寫入 `clarification_turns`，loop 結束並發出 `parse_incomplete` 事件。

**與現況的差異**：現在是把所有缺漏欄位全問；改後 agent 可以只問 1–2 題最關鍵的。

### 4. `compute_quote`（終止）

```ts
輸入：{}    // ← 刻意無參數
輸出：（終止，不回 agent）
```

**無參數是設計重點**：agent 只能表達「我認為可以算了」這個意圖，算什麼、怎麼算完全由程式端用 `extracted_fields` 裡已記錄的值跑 `computeBasePricing`。agent 無法夾帶任何影響金額的資訊（I-1）。

程式端仍會檢查 `still_missing`：若仍有缺漏但預算未盡，視為 agent 判斷失誤，回一個 error result 讓它重試；預算已盡則走保守估算（與現行 `conservative` 路徑一致）。

---

## Agent Loop 與終止條件

```
每輪：
  1. 送出 conversation + tool 定義 → Gemini
  2. 模型回 tool_call 或純文字
  3. 純文字（無 tool_call）→ 視為異常，記 step 後 fallback
  4. 終止類 tool → 執行、記 step、產生 SessionEvent、結束
  5. 查詢類 tool → 執行、記 step、結果回填 conversation → 下一輪
```

### 終止條件（五種）

| # | 條件 | 常數 | 處置 |
| :--- | :--- | :--- | :--- |
| 1 | 呼叫終止類 tool | — | 正常結束，產生對應事件 |
| 2 | step 數達上限 | `MAX_AGENT_STEPS = 8` | fallback → `resolveAfterParse` |
| 3 | 累積延遲超上限 | `MAX_AGENT_LATENCY_MS = 20_000` | fallback（SAD R-1：Vercel 逾時） |
| 4 | 累積成本超上限 | `MAX_AGENT_COST_USD = 0.01` | fallback |
| 5 | 連續 2 次相同 tool + 相同參數 | — | 判定卡住，fallback |

條件 3 的 20 秒是保守值，需在實作後依 P95 實測調整；條件 4 的 0.01 USD 約為現行每案成本（$0.000442）的 **22 倍**，刻意設寬鬆——它是防災上限，不是預期值，真正的成本控制靠 eval 基準線監看。

### Fallback 語意

fallback 不是「報錯」，而是**用 agent 已寫入的 `extracted_fields` 呼叫現行的 `resolveAfterParse`**。也就是說：agent 走了幾步的成果會被保留，只是最後的「問還是算」決策交還給 deterministic 邏輯。使用者完全無感，只會在軌跡上看到 `fallback` 標記。

---

## 與狀態機的接縫（零破壞）

```
                    ┌─────────── parsing 狀態內 ───────────┐
created ──describe──▶│  agent loop（budget 8 steps）        │
                     │    lookup_rate_card → record_fields  │
                     │    → ask_customer / compute_quote    │
                     └──────────────┬───────────────────────┘
                                    │ 產生 SessionEvent
                    ┌───────────────┴──────────────┐
            parse_incomplete                 parse_complete
                    ▼                               ▼
        awaiting_clarification                  pricing
```

agent loop **只在 `parsing` 狀態內執行**，它的唯一對外介面是產生一個既有的 `SessionEvent`，交給既有的 `transition()` 處理。

因此：
- `transitions.ts` 一行不改
- `stateMachine.test.ts`、`transitions` 相關測試全部不改、必須維持綠燈
- session 狀態仍然 durable（agent 不持有跨請求狀態）

**「既有狀態機測試零改動且全綠」是本次改動的驗收條件之一**，它是「沒有破壞既有行為」的機械化證據。

---

## 資料模型

### `agent_steps`（migration 0009）

```sql
CREATE TABLE IF NOT EXISTS agent_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id       UUID NOT NULL,              -- 同一次 loop 的所有 step 共用
  step_index   INTEGER NOT NULL,
  tool_name    TEXT NOT NULL,
  tool_args    JSONB,
  tool_result  JSONB,
  status       TEXT NOT NULL,              -- ok / rejected / error / fallback
  error_detail TEXT,
  cost_log_id  UUID REFERENCES cost_logs(id) ON DELETE SET NULL,
  latency_ms   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_session ON agent_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, step_index);
```

**刻意不加 `merchant_id`**——沿用 `cost_logs`、`price_line_items` 既有的子表慣例：租戶隔離透過 `session_id` 外鍵達成，不在子表重複 denormalize。RLS 維持 deny-by-default，客戶 wizard 全走 service_role server route，商家端讀取經 session 歸屬檢查。

`cost_log_id` 建立「軌跡 ↔ 成本」的關聯，讓每一步都能歸因到具體金額；查詢類 tool 若不含 LLM 呼叫則為 `NULL`（例如 `lookup_rate_card` 是純 DB 查詢，成本為 0）。

---

## Trajectory Eval

現行 11 項指標量的是**單步輸出品質**（欄位對不對）。agent 化之後，「結果對」但「路徑荒謬」（繞了 7 步、重複查 3 次 rate card）是全新的失效模式，必須另外量。

### 新增 4 項指標

| 指標 | 定義 | 為什麼要量 |
| :--- | :--- | :--- |
| `toolSequenceMatchRate` | 實際 tool 序列與標註期望序列一致的案例比例（忽略查詢類 tool 的重複，比對終止類 tool 與關鍵步驟） | agent 有沒有走對路 |
| `avgStepsPerCase` | 平均 step 數 | 效率退化的第一警訊 |
| `redundantCallRate` | 相同 tool + 相同參數的重複呼叫佔總 step 比例 | 抓「原地打轉」 |
| `fallbackRate` | 因預算/迴圈而 fallback 的案例比例 | agent 可靠度的直接指標；**基準線應為 0%** |

### Golden set 標註擴充

36 則案例每則新增 `expectedToolSequence` 標註，例如：

```ts
expectedToolSequence: ["lookup_rate_card", "record_fields", "ask_customer"]
```

這是**人工成本**，需逐則判斷「理想上 agent 該怎麼走」。預估 1–2 小時。

### 基準線重建（必要）

現行基準線（欄位準確率 97.5%、每案 $0.000442、P95 1717ms）是在單步 parser 上量的。agent 化後這些數字**必然變動**，需在同一份 golden set 上重跑，產出改動前後對照表：

| 指標 | 單步 baseline | agent loop | 判定 |
| :--- | ---: | ---: | :--- |
| 欄位抽取準確率 | 97.5% | ? | 不得低於 baseline |
| 幻覺率 | 0% | ? | **必須維持 0%** |
| 每案成本 | $0.000442 | ? | 可接受上升，需記錄倍數 |
| P95 延遲 | 1717ms | ? | 不得超過 8000ms |
| 客戶平均被問題數 | （待補量） | ? | 期望**下降** |

「客戶平均被問題數」是這次改動的**產品價值指標**，目前沒有量過，需在 baseline 側補測，否則無法證明 agent 帶來的體驗改善。

---

## 錯誤處理

| 情境 | 處置 |
| :--- | :--- |
| Gemini 呼叫失敗 | 沿用 `generateStructured` 的重試 1 次 + 指數退避；仍失敗 → fallback |
| tool 參數不合 schema | 回 `rejected` result 給 agent 重試，計入 step 預算；連續 2 次 → fallback |
| agent 呼叫不存在的 tool | 回 error result，同上 |
| `ask_customer` 的 target_field 不在 `still_missing` | 拒絕該題，回 error 說明；agent 可修正後重送 |
| `agent_steps` 寫入失敗 | **best-effort，不中斷主流程**（沿用 `costLogger` 的既有原則：可觀測性不該擋業務） |
| 資料庫寫入失敗（`extracted_fields`） | 往上拋 → route 回 500，session 停於 `parsing`（與現況一致，靠 timeout 回收） |

---

## 安全考量

Tool calling 引入一個現行架構沒有的攻擊面：**注入攻擊可誘導模型選擇錯誤的 tool**，例如讓它跳過 `ask_customer` 直接 `compute_quote`。

現行三層防禦在新架構下的有效性檢視：

| 層 | 現況 | agent 化後 |
| :--- | :--- | :--- |
| 輸入層（2000 字上限） | 有效 | 不變，仍有效 |
| Prompt 層（系統指令聲明「描述是資料不是指令」） | 有效 | 需**擴寫**：明列「客戶描述不得影響 tool 選擇」 |
| 輸出層（金額不經 LLM + 人工審核） | 最強 | **仍是最強，且未被削弱** |

**最壞情境推演**：攻擊者成功讓 agent 跳過反問直接出價 → 程式端偵測到 `still_missing` 非空 → 走保守估算路徑（與現行反問用盡的行為一致）→ 標記 `conservative = true` → 進入商家人工審核。

**結論：注入攻擊的收益上限仍是「讓報價變成保守估算並送人工審核」，無法操縱金額。** 這是 I-1 帶來的結構性保護，不依賴 prompt 的品質。

新增一項 `verify:security` 的檢查：注入樣本必須無法產生 `conservative = false` 且金額異常的報價。

---

## 測試策略

| 層級 | 內容 | 覆蓋率要求 |
| :--- | :--- | :--- |
| 既有測試 | `transitions`/`stateMachine`/`resolveAfterParse` **零改動、全綠** | 維持 |
| 單元：tool executor | 4 個 tool 各自測（repository mock），重點測 `record_fields` 的白名單過濾與值域拒絕 | 90%+ |
| 單元：agent loop | 注入假 LLM（預先編排 tool call 序列），測 5 種終止條件、迴圈偵測、fallback 正確性 | 90%+ |
| 單元：trajectory 指標 | 純函式，用假 `CaseOutcome` 測（沿用既有 `metrics.test.ts` 模式） | 95%+ |
| 整合 | `pnpm verify:agent`（新增）：對真實 Gemini 跑完整 loop | 手動 |
| Eval | `pnpm eval` 擴充 trajectory 指標 | — |
| E2E | 既有 `critical-path.spec.ts` 在 flag 開/關兩種模式下都必須通過 | 維持 |

**E2E 在 flag 兩種模式下都綠，是「使用者流程沒被破壞」的機械化證據。**

---

## 風險與取捨

| 風險 | 嚴重度 | 緩解 |
| :--- | :--- | :--- |
| 延遲上升導致 Vercel 逾時 | **HIGH** | 延遲預算 20s + fallback；eval 監看 P95；必要時降 `MAX_AGENT_STEPS` |
| 成本上升數倍 | MEDIUM | 成本預算上限 + eval 每案成本基準線；Flash-Lite 單價低，絕對值仍極小 |
| agent 品質低於單步 baseline | MEDIUM | Feature flag 可即時關閉；eval 對照表是 go/no-go 依據 |
| golden set 標註成本 | LOW | 36 則，預估 1–2 小時 |
| 幻覺率因多輪對話上升 | **HIGH** | 列為 eval 硬門檻：**幻覺率非 0 即不得開 flag** |

**最大的取捨**：這次改動讓系統變慢、變貴、變得比較不可預測，換來的是「客戶少答幾題」與「商家看得到軌跡」。純以產品 ROI 論，這個交換是邊際的；**主要動機是工程能力的展示與 agent 可靠度議題的實證**，這一點應誠實載明，不應在對外敘述中誇大產品價值。

---

## 里程碑拆分

每個里程碑獨立可驗證、可 review、可 revert。

| # | 內容 | 驗收 |
| :--- | :--- | :--- |
| **A1** | `agent_steps` migration + repository + `agentTrace` | `verify:agent-trace` 綠；寫入失敗不中斷 |
| **A2** | `generateWithTools.ts` + `toolTypes.ts` | 單元測試綠；token 用量正確歸因 |
| **A3** | 4 個 tool + `toolRegistry` | 各 tool 單元測試綠；`record_fields` 拒絕自創欄位 |
| **A4** | `agentLoop` + budget + fallback（flag 預設**關**） | 5 種終止條件測試綠；既有測試零改動全綠 |
| **A5** | Trajectory 指標 + golden set 標註擴充 | `pnpm eval` 產出 15 項指標 |
| **A6** | Baseline 對照：flag 關/開各跑一次 eval | 產出對照表；幻覺率 0%、fallbackRate 0% 才可進 A7 |
| **A7** | 商家後台軌跡 UI | E2E 綠 |
| **A8** | 開 flag + 案例研究文件 | `docs/agent-trajectory-case-study.md` |

A6 是 **go/no-go 關卡**：指標未達標就停在 flag 關閉狀態，不硬推。

---

## 待確認事項

1. `MAX_AGENT_STEPS = 8` 是估計值，需在 A4 實作後依實測調整
2. 「客戶平均被問題數」的 baseline 尚未量測，需在 A5 補測 flag 關閉側
3. `toolSequenceMatchRate` 的比對規則（嚴格順序 vs 忽略查詢類重複）需在 A5 定案
