# Tool-Calling Agent 與 Trajectory Eval — 設計文件（Python 服務版）

**日期：** 2026-08-15
**分支：** `feat/tool-calling-agent`
**基準：** main @ 8083a23
**依賴：** WBS 6.x（Intake/Clarification/Pricing 已完成）、WBS 7.x（Eval 基礎建設已完成）

> **修訂記錄**
> v1（同日）：全 TypeScript 方案。
> **v2（本版）**：AI 層改以獨立 Python 服務實作。三條不變式、終止條件、trajectory 指標設計沿用；架構、技術路線、里程碑、部署與測試策略改寫。變更動機見〈為什麼拆成 Python 服務〉。

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

**目標**：在**不動狀態機、不動計價確定性**的前提下，把 `parsing` 狀態內的決策交給一個有預算上限的 tool-calling agent，並建立能量測其行為軌跡的 trajectory eval。AI 層以獨立 Python 服務實作。

### 非目標（明確不做）

- **不做**多 agent handoff（agent 之間互相交接）
- **不做** RAG / 向量檢索
- **不做** MCP server 封裝（可能的後續任務）
- **不改**任何既有狀態轉移語意（`transitions.ts` 一行都不動）
- **不改**客戶端 wizard 的 4 步結構
- **不搬**計價邏輯到 Python（理由見 I-1）

---

## 三條不變式（設計的地基）

這三條是本次改動的**驗收底線**，任何實作不得違反：

> **I-1｜金額不經過 LLM——且由架構強制，而非約定。**
> 計價邏輯 [`computeBasePricing`](../../../src/domains/pricing/basePricing.ts) **留在 TypeScript 服務內**。Python agent 的 `compute_quote` tool 只能呼叫 `POST /api/internal/pricing/compute` 取得結果，**在物理上沒有能力修改任何計價程式碼或金額**。
>
> 這是 v2 相對 v1 的實質升級：v1 靠「tool 刻意設計成無參數」的約定，v2 靠服務邊界。**約定會被違反，架構不會。**

> **I-2｜缺漏判定不經過 LLM。**
> 「哪些必要欄位還缺」由 confidence 門檻 deterministic 算出（沿用 [`parserAgent.ts:64`](../../../src/domains/intake/parserAgent.ts#L64) `isFieldMissing` 的邏輯，移植為 Python），作為 tool 的**回傳值**餵給 agent，而非讓 agent 自己宣稱。

> **I-3｜agent 失控必須退回現行路徑。**
> 預算用盡、偵測到迴圈、tool 連續失敗、**Python 服務無回應** → TypeScript 端 fallback 到現有的 `resolveAfterParse`，產出與今天完全一致的結果。**agent 是加值層，不是必經路徑。**

I-3 在 v2 有額外份量：跨服務呼叫多了網路失敗與冷啟動兩種失效模式，fallback 從「品質保險」升級為「可用性保險」。

---

## 為什麼拆成 Python 服務

### 動機（誠實陳述）

主要動機有二，兩者都應如實載明：

1. **開發者熟悉度**：作者的訓練背景是 Python，AI 層的迭代速度會顯著較快。
2. **職涯定位**：AI/Agent 工程職缺的生態重心在 Python（LangGraph、DSPy、Agents SDK、評估與資料分析工具鏈）。

**次要但真實的技術收益**：

3. Pydantic 與 Gemini structured output 的整合比 zod 更直接（`response_schema` 可直接吃 Pydantic model，無需 `z.toJSONSchema` 轉換）
4. eval 的統計分析（顯著性檢定、信賴區間）在 Python 生態近乎免費，見〈Eval 統計層〉
5. 服務邊界讓 I-1 從約定升級為架構保證

**不誇大**：這次拆分會讓系統變慢、部署變複雜、跨語言邊界失去編譯期型別保護。若純以產品 ROI 衡量，單體 TypeScript 是更務實的選擇。取捨理由是上述 1、2，應誠實表述。

### 為什麼不是全端 Python

`src/app` 有 40 個 `.tsx`、6,271 行 Next.js 16 + React 19 程式碼，`src/domains/pricing` 有 2,247 行（其中 1,165 行測試）已驗證的計價邏輯。全端重寫需重做約 15,700 行、丟棄 523 個測試與 95.8% 覆蓋率，且重寫期間專案無法演進。**成本與收益不成比例。**

---

## 技術路線

### 自寫 loop vs LangGraph

Python 生態下 LangGraph 是必須認真評估的選項（v1 的「不用框架」論證是針對 TypeScript 生態，不能直接沿用）。

| 面向 | 自寫 loop | LangGraph |
| :--- | :--- | :--- |
| 程式碼量 | ~150 行 | ~80 行 + 框架相依 |
| **狀態來源** | 單一：Supabase `sessions` | **風險：checkpointer 會成為第二個狀態來源** |
| token / 成本歸因 | 直接可控，每步精確 | 需 callback handler，較迂迴 |
| prompt 組裝透明度 | 完全可控（injection 防線需要） | 框架會注入內容，需額外驗證 |
| 履歷關鍵字 | 無 | **有** |
| 面試可講深度 | 高（能講清楚 loop 內部機制） | 中（易被追問「不用框架你會不會寫」） |

**決策：A1–A8 主線自寫 loop。** 決定性理由是狀態來源——本專案的 durable 狀態已經在 Supabase `sessions` 表，引入 LangGraph checkpointer 會造成雙重事實來源，這與整個系統「狀態機是單一事實來源」的設計直接衝突。成本歸因的完整性（`cost_logs` 不得有漏）是第二個理由。

**但不放棄 LangGraph**：列為 **A9（選配）**，在主線跑通、指標基準線建立後，以**相同 tool 定義**平行實作一版，用同一份 golden set 做對照。這比單純「會用 LangGraph」更有說服力——你有兩種實作的實測對照，能講清楚框架的取捨。

### 服務間通訊

| 決策 | 選擇 | 理由 |
| :--- | :--- | :--- |
| 協定 | HTTP + JSON | 唯一合理選擇；gRPC 對兩個服務的規模是過度設計 |
| 型別對齊 | FastAPI 自動產生 OpenAPI → 生成 TS 型別 | 跨語言邊界失去編譯期保護，OpenAPI 是最低成本的補償 |
| 認證 | 雙向 shared secret header | 兩個服務都不對公網開放業務端點 |
| 逾時 | TS 端 45s（Vercel `maxDuration = 60` 留 15s 餘裕） | 見〈延遲預算〉 |

---

## 架構

### 服務拓撲

```
        ┌──────────────────────── Vercel ────────────────────────┐
瀏覽器 ─▶│ Next.js 16                                            │
        │   /q/{slug} wizard（不動）                             │
        │   /api/sessions/{id}/describe  ─┐                      │
        │   /api/sessions/{id}/answer    ─┤                      │
        │   orchestrator/                 │                      │
        │     transitions.ts（不動）      │                      │
        │     describeFlow.ts ────────────┼──┐                   │
        │     resolveAfterParse.ts（fallback 保留）              │
        │   /api/internal/pricing/compute ◀─┼──┐  ← 新增          │
        │   domains/pricing/（不動，I-1）   │  │                  │
        └───────────────────────────────────┼──┼──────────────────┘
                                            │  │
                        HTTP + shared secret│  │HTTP
                                            ▼  │
        ┌──────────── Railway / Render / Fly.io ┴─────────────────┐
        │ FastAPI  agent-service                                  │
        │   POST /agent/resolve                                   │
        │     agent/loop.py  ← tool-calling loop（budget 8 steps）│
        │       tools: lookup_rate_card, record_fields,           │
        │              ask_customer, compute_quote ───────────────┘
        │     llm/gemini.py  ← google-genai + cost_logs
        │     trace/agent_steps.py
        └─────────────────────┬───────────────────────────────────┘
                              ▼
                        Supabase（共用）
```

### Python 服務結構

```
agent-service/
  pyproject.toml            uv / poetry；ruff + mypy + pytest
  app/
    main.py                 FastAPI entry、lifespan、健康檢查
    config.py               Pydantic Settings（對應 TS 的 env.ts，啟動時 fail-fast）
    api/
      routes.py             POST /agent/resolve、GET /health
      auth.py               內部 shared secret 驗證（依賴注入）
    agent/
      loop.py               loop 本體：終止條件、迴圈偵測
      budget.py             預算常數與耗盡判定
      registry.py           tool 名稱 → (schema, executor) 查表（無 if/elif 鏈）
      tools/
        lookup_rate_card.py
        record_fields.py
        ask_customer.py
        compute_quote.py    ← 呼叫回 TS 的 internal pricing API
    llm/
      gemini.py             generate_structured / generate_with_tools
      cost.py               每次呼叫寫 cost_logs（沿用既有表）
    schemas/                Pydantic models（欄位定義、tool IO、FlowOutcome）
    db/
      client.py             supabase-py
      repositories/         sessions / extracted_fields / clarification_turns / agent_steps
    trace/
      agent_steps.py        每步寫入（best-effort）
  eval/
    golden_set/             36 則案例（從 TS 移植 + trajectory 標註）
    runner.py
    metrics.py              既有 11 項
    trajectory.py           新增 4 項
    analysis.py             pandas + scipy：顯著性檢定、信賴區間
  tests/
```

### TypeScript 端改動

| 檔案 | 改動 | 估計 |
| :--- | :--- | ---: |
| `src/lib/agentService.ts`（新） | HTTP client：呼叫 Python、逾時、失敗判定 | ~80 行 |
| `src/app/api/internal/pricing/compute/route.ts`（新） | 內部計價端點，shared secret 保護 | ~60 行 |
| [`describeFlow.ts`](../../../src/orchestrator/describeFlow.ts) | `parseIntake` + `resolveAfterParse` → 呼叫 agent service；失敗則 fallback | ~50 行 |
| `answerFlow.ts` | 同上 | ~40 行 |
| `src/lib/env.ts` | 新增 `AGENT_SERVICE_URL`、`INTERNAL_SERVICE_SECRET` | ~5 行 |
| `src/types/agentService.ts`（新） | 由 OpenAPI 生成 | 自動 |

**不動**：13 個 API route、40 個 `.tsx`、`transitions.ts`、`stateMachine.ts`、`domains/pricing/`、`domains/merchant/`、全部 E2E 測試。

---

## Tool 介面定義

Pydantic model 定義，FastAPI 自動轉 Gemini `function_declarations`。

### 1. `lookup_rate_card`（查詢，可重複）

```python
class LookupRateCardInput(BaseModel):
    category: CaseCategory

class LookupRateCardOutput(BaseModel):
    subtypes: list[str]
    field_options: dict[str, list[str] | None]
```

無 LLM，純查 Supabase。**存在理由**：讓 agent 在抽取前後都能查值域，取代現行「事前硬塞 `allowedSubtypes`」。這是「客戶要的東西我們沒有」情境能被追問的前提。

### 2. `record_fields`（查詢，可重複）

```python
class RecordFieldsOutput(BaseModel):
    accepted: list[str]
    rejected: list[RejectedField]      # 不在白名單 / 值域外
    still_missing: list[str]           # ← deterministic 算出（I-2）
```

程式端做三件事：白名單過濾（拒絕自創欄位）、值域檢查、寫入 `extracted_fields`，然後算出 `still_missing` 回給 agent。

**整個設計最關鍵的一個 tool**：agent 得知「還缺什麼」的唯一管道是程式端的 deterministic 判定，它無法自行宣稱「都齊了」。

### 3. `ask_customer`（終止）

```python
class AskCustomerInput(BaseModel):
    questions: list[ClarificationItem]  # target_field + question
```

驗證每個 `target_field` 必為 `still_missing` 成員（沿用現行不變式），寫入 `clarification_turns`，loop 結束並回傳 `parse_incomplete` 事件給 TS 端。

**與現況的差異**：現在把所有缺漏欄位全問；改後 agent 可只問 1–2 題最關鍵的。

### 4. `compute_quote`（終止）

```python
class ComputeQuoteInput(BaseModel):
    pass    # ← 刻意無欄位
```

**無欄位 + 跨服務邊界，是 I-1 的雙重保障。** agent 只能表達「我認為可以算了」，實際計價由 Python 呼叫 TS 的 `POST /api/internal/pricing/compute`，用 `extracted_fields` 已記錄的值計算。agent 無法夾帶任何影響金額的資訊，也碰不到計價程式碼。

程式端仍檢查 `still_missing`：仍有缺漏但預算未盡 → 回 error 讓 agent 重試；預算已盡 → 保守估算（與現行 `conservative` 路徑一致）。

---

## Agent Loop 與終止條件

```
每輪：
  1. 送出 conversation + function_declarations → Gemini
  2. 模型回 function_call 或純文字
  3. 純文字（無 function_call）→ 視為異常，記 step 後 fallback
  4. 終止類 tool → 執行、記 step、回傳事件、結束
  5. 查詢類 tool → 執行、記 step、結果回填 conversation → 下一輪
```

### 終止條件（六種）

| # | 條件 | 常數 | 處置 |
| :--- | :--- | :--- | :--- |
| 1 | 呼叫終止類 tool | — | 正常結束，回傳對應事件 |
| 2 | step 數達上限 | `MAX_AGENT_STEPS = 8` | fallback |
| 3 | 累積延遲超上限 | `MAX_AGENT_LATENCY_MS = 35_000` | fallback |
| 4 | 累積成本超上限 | `MAX_AGENT_COST_USD = 0.01` | fallback |
| 5 | 連續 2 次相同 tool + 相同參數 | — | 判定卡住，fallback |
| 6 | **TS 端呼叫 Python 逾時/失敗** | TS `AGENT_TIMEOUT_MS = 45_000` | **TS 端** fallback（v2 新增） |

條件 6 是 v2 才有的：Python 服務不可用時，TypeScript 端必須能獨立完成流程。這也是保留 `resolveAfterParse.ts` 不刪的原因。

### 延遲預算（v2 收緊）

```
Vercel maxDuration = 60s（Hobby 上限，describe route 已設定）
  └─ TS → Python 呼叫逾時 45s
       └─ Python agent loop 預算 35s
            └─ 單次 Gemini 呼叫 ~1.3s × 最多 8 步 ≈ 10s（正常）
       └─ 餘裕 10s：網路往返、冷啟動、pricing 回呼
  └─ 餘裕 15s：TS 端 fallback 完整跑一次 resolveAfterParse
```

最後 15s 的餘裕是關鍵：**逾時後還要有時間走完 fallback**，否則條件 6 形同虛設。

### Fallback 語意

fallback 不是報錯，而是**用 agent 已寫入的 `extracted_fields` 呼叫現行的 `resolveAfterParse`**。agent 走了幾步的成果被保留，只是最後的「問還是算」決策交還給 deterministic 邏輯。使用者完全無感，只在軌跡上看到 `fallback` 標記。

---

## 與狀態機的接縫（零破壞）

```
                    ┌────────── parsing 狀態內（Python） ──────────┐
created ──describe──▶│  agent loop（budget 8 steps）               │
                     │    lookup_rate_card → record_fields         │
                     │    → ask_customer / compute_quote           │
                     └──────────────┬──────────────────────────────┘
                                    │ 回傳 SessionEvent 字串
                    ┌───────────────┴──────────────┐
            parse_incomplete                 parse_complete
                    ▼                               ▼
        awaiting_clarification                  pricing
                （TypeScript transition() 處理）
```

**Python 服務不碰狀態轉移。** 它的唯一對外輸出是一個既有的 `SessionEvent` 字串，交回 TypeScript 的 `transition()` 處理。狀態機仍是 TS 端的單一事實來源。

因此：
- `transitions.ts` 一行不改
- `stateMachine.test.ts` 等既有測試全部不改、必須維持綠燈
- session 狀態仍 durable，Python 服務完全無狀態（可任意重啟 / 水平擴充）

**「既有狀態機測試零改動且全綠」是本次改動的驗收條件之一。**

---

## 資料模型

### `agent_steps`（migration 0009）

```sql
CREATE TABLE IF NOT EXISTS agent_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id       UUID NOT NULL,
  step_index   INTEGER NOT NULL,
  tool_name    TEXT NOT NULL,
  tool_args    JSONB,
  tool_result  JSONB,
  status       TEXT NOT NULL,        -- ok / rejected / error / fallback
  error_detail TEXT,
  cost_log_id  UUID REFERENCES cost_logs(id) ON DELETE SET NULL,
  latency_ms   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_session ON agent_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, step_index);
```

**刻意不加 `merchant_id`**——沿用 `cost_logs`、`price_line_items` 的子表慣例：租戶隔離透過 `session_id` 外鍵達成，不在子表重複 denormalize。RLS 維持 deny-by-default。

Migration 由 TypeScript 端管理（沿用既有 `supabase/migrations/` 與手動套用 + GRANT 的既有流程），Python 服務只讀寫、不管 schema——**避免兩個服務都能改 schema 造成的版本混亂**。

---

## Trajectory Eval

現行 11 項指標量的是**單步輸出品質**。agent 化後，「結果對」但「路徑荒謬」（繞 7 步、重複查 3 次 rate card）是全新的失效模式。

### 新增 4 項指標

| 指標 | 定義 | 為什麼要量 |
| :--- | :--- | :--- |
| `tool_sequence_match_rate` | 實際 tool 序列與標註期望序列一致的比例 | agent 有沒有走對路 |
| `avg_steps_per_case` | 平均 step 數 | 效率退化的第一警訊 |
| `redundant_call_rate` | 相同 tool + 相同參數的重複呼叫佔比 | 抓「原地打轉」 |
| `fallback_rate` | 因預算/迴圈/服務失敗而 fallback 的比例 | agent 可靠度；**基準線應為 0%** |

### Eval 統計層（Python 的實質收益）

現行 eval 只有點估計。36 則樣本下，「81.4% → 97.1%」這類宣稱**缺少統計基礎**，面試時會被追問「這個差異顯著嗎」。

`eval/analysis.py` 新增：

- **McNemar 檢定**：前後配對比較（同一批案例、改動前後），正是此場景的正確檢定
- **Wilson 信賴區間**：小樣本比例的區間估計（優於常態近似）
- **樣本量檢定力分析**：回答「要偵測 5pp 的差異，36 則夠嗎」

輸出格式改為 `97.1% [93.2%, 99.0%]`（點估計 + 95% CI），並在案例研究中附上 p 值。

> **這修掉了現行 eval 的一個真實弱點**，不只是換語言的副產品。

### 基準線重建（必要）

現行基準線（欄位準確率 97.5%、每案 $0.000442、P95 1717ms）是在單步 parser 上量的，agent 化後必然變動。需在同一份 golden set 上重跑：

| 指標 | 單步 baseline | agent loop | 判定 |
| :--- | ---: | ---: | :--- |
| 欄位抽取準確率 | 97.5% | ? | 不得顯著低於 baseline（McNemar p ≥ 0.05） |
| 幻覺率 | 0% | ? | **必須維持 0%** |
| 每案成本 | $0.000442 | ? | 可接受上升，需記錄倍數 |
| P95 延遲 | 1717ms | ? | 不得超過 20,000ms（含跨服務往返） |
| 客戶平均被問題數 | （**待補量**） | ? | 期望**下降** |

「客戶平均被問題數」是本次改動的**產品價值指標**，目前沒量過，需在 baseline 側補測，否則無法證明體驗改善。

---

## 錯誤處理

| 情境 | 處置 |
| :--- | :--- |
| **Python 服務無回應 / 逾時**（v2 新增） | TS 端 fallback 到 `resolveAfterParse`，記錄告警 |
| **Python 服務冷啟動**（v2 新增） | 見〈風險〉；health check 保溫 + 首呼叫容忍較長逾時 |
| **pricing 內部 API 呼叫失敗**（v2 新增） | Python 回傳 `pricing_unavailable`，TS 端接手用本地 `computeBasePricing` 完成 |
| Gemini 呼叫失敗 | 重試 1 次 + 指數退避（沿用現行策略）；仍失敗 → fallback |
| tool 參數不合 Pydantic schema | 回 `rejected` 給 agent 重試，計入 step 預算；連續 2 次 → fallback |
| agent 呼叫不存在的 tool | 回 error result，同上 |
| `ask_customer` 的 target_field 不在 `still_missing` | 拒絕該題，回 error 說明；agent 可修正後重送 |
| `agent_steps` 寫入失敗 | **best-effort，不中斷主流程**（沿用 `costLogger` 既有原則） |
| `extracted_fields` 寫入失敗 | 往上拋 → TS route 回 500，session 停於 `parsing`（與現況一致，靠 timeout 回收） |

---

## 安全考量

### 既有三層防禦在新架構下的檢視

| 層 | 現況 | v2 |
| :--- | :--- | :--- |
| 輸入層（2000 字上限） | 有效 | 不變，仍在 TS 端驗證（**邊界越前面越好**） |
| Prompt 層 | 有效 | 需**擴寫**：明列「客戶描述不得影響 tool 選擇」 |
| 輸出層（金額不經 LLM + 人工審核） | 最強 | **更強**——升級為跨服務的架構保證（I-1） |

**最壞情境推演**：攻擊者成功讓 agent 跳過反問直接 `compute_quote` → 程式端偵測 `still_missing` 非空 → 保守估算（與現行反問用盡行為一致）→ 標記 `conservative = true` → 進入商家人工審核。

**注入攻擊的收益上限仍是「讓報價變成保守估算並送人工審核」，無法操縱金額。**

### v2 新增的攻擊面

| 風險 | 緩解 |
| :--- | :--- |
| Python 服務端點暴露於公網 | 業務端點一律要求 shared secret header；只開放 `/health` 匿名 |
| 內部 pricing API 被外部呼叫 | 同上，雙向驗證；`/api/internal/**` 於 middleware 拒絕無 secret 的請求 |
| 服務間流量明文 | 兩端皆強制 HTTPS |
| secret 外洩 | 走各平台 secret manager（Vercel env / Railway variables），不進版控；`.env.example` 只列名稱 |

`verify:security` 新增兩項檢查：注入樣本無法產生 `conservative = false` 的異常報價；無 secret 的 `/api/internal/**` 請求回 401。

---

## 測試策略

| 層級 | 內容 | 要求 |
| :--- | :--- | :--- |
| **既有 TS 測試** | `transitions` / `stateMachine` / `resolveAfterParse` **零改動、全綠** | 維持 |
| **既有 TS 覆蓋率** | vitest 門檻 80% | 維持（移出的 intake/eval 一併移出分母） |
| Python 單元：tool executor | 4 個 tool（repository mock），重點測 `record_fields` 白名單與值域拒絕 | 90%+ |
| Python 單元：agent loop | 假 LLM（預先編排 function_call 序列），測 6 種終止條件、迴圈偵測、fallback | 90%+ |
| Python 單元：指標 | 純函式，假資料 | 95%+ |
| **契約測試**（v2 新增） | OpenAPI schema 與 TS 型別一致性；CI 驗證兩端未漂移 | 必須 |
| **TS 端 fallback 測試**（v2 新增） | mock agent service 逾時/500/連線失敗 → 驗證退回 `resolveAfterParse` 且結果與今日一致 | 必須 |
| 整合 | `pnpm verify:agent`：對真實 Python 服務 + Gemini 跑完整 loop | 手動 |
| E2E | 既有 `critical-path.spec.ts` 在 **agent 開 / 關 / 服務停機** 三種模式下都通過 | 維持 |

**E2E 在「Python 服務停機」下仍通過，是 I-3 的機械化證據。**

### CI 調整

現行 [`ci.yml`](../../../.github/workflows/ci.yml) 三道閘門（lint / tsc / vitest）保留，新增平行 job：

```
jobs:
  quality       （既有，不動）
  python-quality（新）ruff + mypy --strict + pytest + coverage
  contract      （新）OpenAPI ↔ TS 型別一致性檢查
```

---

## 風險與取捨

| 風險 | 嚴重度 | 緩解 |
| :--- | :--- | :--- |
| **免費層冷啟動**（Render/Railway 閒置休眠，首次喚醒可達 30s+） | **CRITICAL** | 作品集 demo 的致命傷。緩解：選有常駐免費額度的平台（Fly.io）或設外部 cron 保溫；`/health` 輕量端點；首呼叫容忍較長逾時。**A0 必須實測冷啟動時間並記錄** |
| 跨服務延遲吃掉 Vercel 60s 預算 | **HIGH** | 分層逾時（45s / 35s）+ 15s fallback 餘裕；eval 監看 P95 |
| 跨語言型別漂移 | **HIGH** | OpenAPI 生成 TS 型別 + CI 契約測試擋 |
| 部署複雜度（兩處環境變數、兩條 CI） | MEDIUM | A0 一次做完並寫進 `docs/deployment.md` |
| agent 品質低於單步 baseline | MEDIUM | Feature flag 可即時關閉；A6 對照表是 go/no-go 依據 |
| 幻覺率因多輪對話上升 | **HIGH** | eval 硬門檻：**幻覺率非 0 即不得開 flag** |
| golden set 移植 + trajectory 標註 | LOW | 36 則，預估 2–3 小時 |

**最大的取捨**（誠實版）：這次改動讓系統變慢、變貴、部署變複雜、失去跨邊界的編譯期型別保護，換來客戶少答幾題與商家可見軌跡。純產品 ROI 是負的。真正的動機是開發者熟悉度與職涯定位，**對外敘述時應如實說明技術取捨，不應包裝成產品驅動的決策**。

---

## 里程碑拆分

每個里程碑獨立可驗證、可 review、可 revert。

| # | 內容 | 驗收 |
| :--- | :--- | :--- |
| **A0** | Python 服務骨架：FastAPI + config + `/health` + 部署 + shared secret + TS 端 client 打通一條 echo 呼叫鏈 | 線上可呼叫；**冷啟動時間實測並記錄**；CI 兩條 job 綠 |
| **A1** | `agent_steps` migration + Python repository + trace 寫入 | 寫入失敗不中斷主流程 |
| **A2** | `llm/gemini.py`：`generate_structured` 移植 + `generate_with_tools` | 單元測試綠；token 用量正確寫入 `cost_logs` |
| **A3** | 4 個 tool + registry；`/api/internal/pricing/compute`（TS 側） | 各 tool 測試綠；`record_fields` 拒絕自創欄位 |
| **A4** | `agent/loop.py` + budget + fallback；TS 端 fallback 路徑（flag 預設**關**） | 6 種終止條件測試綠；**服務停機下 E2E 仍綠** |
| **A5** | Golden set 移植 + trajectory 標註 + 4 項指標 + `analysis.py` 統計層 | `python -m eval.runner` 產出 15 項指標 + 信賴區間 |
| **A6** | Baseline 對照：flag 關/開各跑一次 | 對照表附 p 值；幻覺率 0%、`fallback_rate` 0% 才可進 A7 |
| **A7** | 商家後台軌跡 UI（TS） | E2E 綠 |
| **A8** | 開 flag + 案例研究文件 | `docs/agent-trajectory-case-study.md` |
| **A9**（選配） | LangGraph 平行實作 + 對照分析 | 同一 golden set 的雙實作對照表 |

**A0 是本版新增的前置關卡**，且其冷啟動實測結果可能推翻平台選擇——若無法壓到可接受範圍，需回頭評估是否改用 Vercel Python Functions 或退回單體 TypeScript。
**A6 是 go/no-go 關卡**：指標未達標就停在 flag 關閉狀態，不硬推。

---

## 待確認事項

1. **Python 服務託管平台**：Fly.io / Railway / Render 的免費層冷啟動行為需在 A0 實測後定案
2. `MAX_AGENT_STEPS = 8`、`MAX_AGENT_LATENCY_MS = 35_000` 為估計值，需依 A4 實測調整
3. 「客戶平均被問題數」的 baseline 尚未量測，需在 A5 補測 flag 關閉側
4. `tool_sequence_match_rate` 的比對規則（嚴格順序 vs 忽略查詢類重複）需在 A5 定案
5. 套件管理器：`uv`（快、新）vs `poetry`（穩、普及）——A0 定案
