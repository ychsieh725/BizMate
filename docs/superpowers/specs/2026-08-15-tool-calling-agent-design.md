# Tool-Calling Agent 與 Trajectory Eval — 設計文件（Python 服務版）

**日期：** 2026-08-15
**分支：** `feat/tool-calling-agent`
**基準：** main @ 8083a23
**依賴：** WBS 6.x（Intake/Clarification/Pricing 已完成）、WBS 7.x（Eval 基礎建設已完成）

> **修訂記錄**
> v1（同日）：全 TypeScript 方案。
> v2（同日）：AI 層改以獨立 Python 服務實作。變更動機見〈為什麼拆成 Python 服務〉。
> v3（同日）：修正 v2 的部署評估錯誤。v2 誤判 Vercel 無法承載 Python 服務而規劃第三方平台（Railway/Render/Fly.io），並據此把冷啟動列為 CRITICAL 風險、以 Vercel Hobby 60s 上限推導延遲預算。**兩項前提皆與官方文件不符**：Vercel 原生支援 FastAPI，且提供 Services 機制讓 Python 與 Next.js 共存於同一 project；Hobby 方案在 Fluid compute 下的執行上限為 300s。本版據此改寫部署架構、延遲預算、風險表與 A0。查證來源見文末。
> **v4（2026-08-17，本版）**：**v3 的「單一 Vercel project + Services」假設經實測不成立**，改寫〈部署架構〉與 A0 驗收。`experimentalServices` 已被 Vercel 停用，`services` 建置雖過但整站路由失效。Python 服務降級為「本機開發與離線 eval 用」，正式站不部署它——因 flag 預設關閉，正式站行為不受影響。實測記錄見〈A0 部署實測〉。**本次修正只動部署層，不影響本文件其餘任何設計。**

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

I-3 在 v2 起有額外份量：跨服務呼叫多了網路失敗與冷啟動兩種失效模式，fallback 從「品質保險」升級為「可用性保險」。（v3：冷啟動在 Vercel 上約 1 秒量級，威脅程度遠低於 v2 假設的容器休眠平台，但失效模式本身仍存在，fallback 設計不變。）

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

**不誇大**：這次拆分會讓系統變慢、多一套建置設定、跨語言邊界失去編譯期型別保護。若純以產品 ROI 衡量，單體 TypeScript 是更務實的選擇。取捨理由是上述 1、2，應誠實表述。

> **v3 修正**：v2 曾把「部署複雜度大幅上升」列為主要代價，那建立在「須引入第三方託管平台」的錯誤前提上。Vercel Services 讓兩個 runtime 共存於同一 project、共用 domain、依 service 名自動注入環境變數，實際新增的只有一套 Python 建置設定與一條 CI job。**部署複雜度不再是本方案的主要代價**；真正的固有成本是跨語言型別邊界與本機需同時啟動兩個服務。

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
| 認證 | 雙向 shared secret header | 即使同域，Python 端點仍可被外部直接請求，不可只靠網路位置當防線 |
| 逾時 | TS 端 90s（Hobby 上限 300s，餘裕充足） | 見〈延遲預算〉 |

---

## 部署架構（v4 改寫）

> ### ⚠️ v4 修正：本節的 v3 決策經實測推翻
>
> 下方「單一 Vercel project + Services」的方案**沒有成立**。2026-08-17 實測：
>
> | 設定 | 結果 |
> | :--- | :--- |
> | `experimentalServices` | Vercel 拒絕：「no longer available for new projects」 |
> | `services` + `bindings` | 建置成功但所有路由 404（`Build output contains no "functions" or "static" directory`）；另外 `services` 沒有 `mount` 屬性，且雙向 `bindings` 被判定為循環相依 |
> | 沒有 `vercel.json` | ✅ 全站正常 |
>
> **現況**：repo 不含 `vercel.json`，正式站維持純 Next.js 部署，**agent-service
> 不上線**。因 `AGENT_LOOP_ENABLED` 預設關閉、`AGENT_SERVICE_URL` 未設定時
> `callAgentService` 回 `not_configured` 並 fallback，正式站行為與導入 agent
> 之前完全相同（不變式 I-3 在此發揮的正是它被設計出來的作用）。
>
> **要上線時走 v3 已記載的退路**：拆成第二個 Vercel project，改一個環境變數即可，
> 程式碼零改動。步驟見 [`docs/deployment.md`](../../deployment.md)。
>
> 以下 v3 內容保留作為決策脈絡，**「已採用」的標記皆不再成立**。

### 平台決策（v3 提案，已推翻）：單一 Vercel project + Services

Vercel 原生支援 Python runtime，FastAPI 為零設定部署（整個 app 成為一個 Vercel Function）。官方提供 **Services** 機制讓 Python 後端與前端共存於同一 project：各自獨立 build、共用 domain、依 URL 路徑前綴自動路由，並**依 service 名稱自動注入環境變數**。

| 方案 | 單一 project（Services）✅ 採用 | 兩個 project |
| :--- | :--- | :--- |
| Domain | 一個，Python 掛路徑前綴 | 兩個獨立 URL |
| 部署 | 一次 push 兩邊同時上 | 各自獨立 |
| 環境變數 | 依 service 名自動注入 | 手動維護兩套 |
| **Preview deployment** | **兩邊同一快照，PR 即完整系統** | 需自行處理版本對應 |
| API 穩定性 | ⚠️ `experimentalServices`，實驗性 | 標準做法 |
| 失敗隔離 | 一邊 build 失敗擋住整個部署 | 互不影響 |
| 獨立 rollback | 不行 | 可以 |

**採用單一 project**，決定性理由是**遷移成本不對稱**：單一 → 兩個只需改一個 URL 環境變數，很便宜；反之則一開始就得承擔 preview 版本不同步的維運負擔。先取簡單解，不行再拆。

Preview deployment 一致性對本專案特別重要：作品集需要一個「點連結就是完整可玩系統」的快照。

> **I-1 在兩種方案下都成立。** Services 是各自獨立 build 的不同 function，Python 仍只能透過 HTTP 呼叫 pricing API，行程層級的隔離不因共用 domain 而消失。

### 平台限制（官方文件，2026-07 查證）

| 項目 | Hobby 方案（Fluid compute） |
| :--- | :--- |
| 最大執行時間 | **300s**（預設即 300s） |
| Python bundle 上限 | **500 MB**（其他 runtime 為 250 MB） |
| 記憶體 | 2 GB / 1 vCPU |
| Request/Response body | 4.5 MB |
| 冷啟動 | 約 0.8–1.5s 量級 |
| 計費 | **active CPU time；等待 I/O 不計費** |

最後一項對本案特別有利：agent loop 大部分時間在等 Gemini 回應，這段等待不計入計費。

> ⚠️ **前提**：上述數字須在 **Fluid compute 啟用**下才成立。官方稱新專案預設啟用，但本專案的 Vercel project 為既有專案，**須於 A0 在 dashboard 確認**。
>
> ⚠️ **既有程式碼的過期註解**：[`describe/route.ts`](../../../src/app/api/sessions/[id]/describe/route.ts) 的 `maxDuration = 60` 註解寫著「60 為 Hobby 上限，取滿」，該上限現已為 300s，需一併更正。

### 服務拓撲

```
        ┌───────────────── 單一 Vercel Project ──────────────────┐
        │                                                        │
        │  ┌── service: web（Next.js 16）──────────────────────┐ │
瀏覽器 ─▶│  │   /q/{slug} wizard（不動）                        │ │
        │  │   /api/sessions/{id}/describe ─┐                  │ │
        │  │   /api/sessions/{id}/answer   ─┤                  │ │
        │  │   orchestrator/                │                  │ │
        │  │     transitions.ts（不動）     │                  │ │
        │  │     describeFlow.ts ───────────┼──┐               │ │
        │  │     resolveAfterParse.ts（fallback 保留）         │ │
        │  │   /api/internal/pricing/compute ◀─┼──┐ ← 新增      │ │
        │  │   domains/pricing/（不動，I-1）   │  │            │ │
        │  └───────────────────────────────────┼──┼────────────┘ │
        │                  HTTP + shared secret│  │HTTP          │
        │  ┌── service: agent（FastAPI）───────▼──┴────────────┐ │
        │  │   POST /agent/resolve                             │ │
        │  │     agent/loop.py ← tool-calling loop（8 steps）  │ │
        │  │       tools: lookup_rate_card, record_fields,     │ │
        │  │              ask_customer, compute_quote          │ │
        │  │     llm/gemini.py ← google-genai + cost_logs      │ │
        │  │     trace/agent_steps.py                          │ │
        │  └────────────────────┬──────────────────────────────┘ │
        └───────────────────────┼────────────────────────────────┘
                                ▼
                          Supabase（共用）
```

---

## 架構

### Python 服務結構

```
agent-service/
  pyproject.toml            依賴 + [tool.vercel] entrypoint；ruff + mypy + pytest
  app/
    main.py                 FastAPI entry（頂層變數須命名 app）、lifespan、健康檢查
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

**Vercel 慣例對應**：entrypoint 檔名須為 `app.py` / `index.py` / `server.py` / `main.py` / `wsgi.py` / `asgi.py` 之一（可置於 `app/` 或 `src/` 下），且頂層變數命名為 `app`；本結構的 `app/main.py` 直接符合，無需額外設定。若之後調整路徑，改以 `pyproject.toml` 的 `[tool.vercel] entrypoint = "module:variable"` 指定。

**Bundle 控制**：Python 無自動 tree-shaking，預設打包所有 build 時可達的檔案。`eval/`（含 golden set 與統計分析層）**僅離線執行、不應進 function bundle**，日後部署時須以 `functions.excludeFiles` 排除。

> **v4 更新**：本段原本的主要動機是排除 pandas/scipy。A5 實作時發現 Wilson 區間有封閉解、McNemar 用精確二項檢定即可，**兩者都用標準函式庫寫得出來**（`statistics.NormalDist` + `math.comb`），於是那兩個套件根本沒進相依。bundle 風險連同它們一起消失，本段降為預防性提醒。

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
| 3 | 累積延遲超上限 | `MAX_AGENT_LATENCY_MS = 60_000` | fallback |
| 4 | 累積成本超上限 | `MAX_AGENT_COST_USD = 0.01` | fallback |
| 5 | 連續 2 次相同 tool + 相同參數 | — | 判定卡住，fallback |
| 6 | **TS 端呼叫 Python 逾時/失敗** | TS `AGENT_TIMEOUT_MS = 90_000` | **TS 端** fallback（v2 新增） |

條件 6 是 v2 才有的：Python 服務不可用時，TypeScript 端必須能獨立完成流程。這也是保留 `resolveAfterParse.ts` 不刪的原因。

### 延遲預算（v3 重算）

v2 的分層預算（45s / 35s）建立在「Hobby 上限 60s」的錯誤前提上。實際上限為 300s，預算大幅放寬：

```
Vercel maxDuration = 180s（describe route 調整；Hobby 上限 300s）
  └─ TS → Python 呼叫逾時 90s
       └─ Python agent loop 預算 60s
            └─ 單次 Gemini 呼叫 ~1.3s × 最多 8 步 ≈ 10s（正常情形）
       └─ 餘裕 30s：網路往返、冷啟動、pricing 回呼、重試退避
  └─ 餘裕 90s：TS 端 fallback 完整跑一次 resolveAfterParse
```

設計原則不變：**逾時後必須還有時間走完 fallback**，否則條件 6 形同虛設。v3 的差別是餘裕從勉強的 15s 變成寬鬆的 90s。

> **但預算寬鬆不等於可以慢。** 300s 是平台上限，不是使用者的耐心上限——客戶在 wizard 前面等待，超過 10 秒體驗就已經很差。真正的延遲約束來自 eval 的 P95 門檻（見〈基準線重建〉），而非平台限制。**平台上限只是安全網，不是目標值。**

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
| P95 延遲 | 1717ms | ? | **不得超過 10,000ms**（含跨服務往返）——依使用者耐心設定，非平台上限 |
| 客戶平均被問題數 | （**待補量**） | ? | 期望**下降** |

「客戶平均被問題數」是本次改動的**產品價值指標**，目前沒量過，需在 baseline 側補測，否則無法證明體驗改善。

---

## 錯誤處理

| 情境 | 處置 |
| :--- | :--- |
| **Python 服務無回應 / 逾時**（v2 新增） | TS 端 fallback 到 `resolveAfterParse`，記錄告警 |
| **Python 服務冷啟動**（v2 新增） | Vercel 冷啟動約 1s 量級，已含在 90s 逾時餘裕內，無需保溫機制 |
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
| secret 外洩 | 走 Vercel 環境變數（Services 依 service 名自動注入），不進版控；`.env.example` 只列名稱 |
| **同域造成的誤判**（v3 新增） | 共用 domain 不代表 Python 端點受保護——它仍可被外部直接請求。shared secret 驗證**不因同域而省略** |

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
| ~~**`experimentalServices` 為實驗性 API**~~（v3 新增） | ~~HIGH~~ → **已發生** | **這個風險成真了**：Vercel 已對新專案停用該 API，`services` 替代方案也無法讓兩個 runtime 共存。緩解奏效——退路（拆 project、改一個環境變數）事前就寫在 `docs/deployment.md`，且因 flag 預設關閉，正式站零影響。**代價僅為 agent-service 暫不上線**（v4） |
| **Fluid compute 未啟用**（v3 新增） | MEDIUM | 既有 project 可能未啟用，導致執行上限退回舊值。A0 於 dashboard 確認並記錄 |
| 冷啟動 | LOW | Vercel 冷啟動約 0.8–1.5s，已含在逾時餘裕內。**（v2 誤列為 CRITICAL，前提是容器平台休眠；平台改為 Vercel 後此風險降級）** |
| 使用者感知延遲（非平台限制） | **HIGH** | 平台容許 300s，但客戶在 wizard 等待超過 10s 體驗即劣化。真正的約束是 eval P95 門檻，不是平台上限 |
| 跨語言型別漂移 | **HIGH** | OpenAPI 生成 TS 型別 + CI 契約測試擋 |
| 部署設定（Python 建置 + 一條 CI job） | LOW | 單一 project + Services 下環境變數自動注入；A0 一次做完並寫進 `docs/deployment.md` |
| ~~Bundle 誤含 eval 相依（pandas/scipy）~~ | ~~MEDIUM~~ → **已消滅** | A5 把統計層改用純標準函式庫（`statistics.NormalDist` + `math.comb`）實作 Wilson 區間與 McNemar 檢定，**pandas/scipy 根本沒進相依**。bundle 風險連同它們一起消失（v4） |
| agent 品質低於單步 baseline | MEDIUM | Feature flag 可即時關閉；A6 對照表是 go/no-go 依據 |
| 幻覺率因多輪對話上升 | **HIGH** | eval 硬門檻：**幻覺率非 0 即不得開 flag** |
| golden set 移植 + trajectory 標註 | LOW | 36 則，預估 2–3 小時 |

**最大的取捨**（誠實版）：這次改動讓系統變慢、變貴、部署變複雜、失去跨邊界的編譯期型別保護，換來客戶少答幾題與商家可見軌跡。純產品 ROI 是負的。真正的動機是開發者熟悉度與職涯定位，**對外敘述時應如實說明技術取捨，不應包裝成產品驅動的決策**。

---

## 里程碑拆分

每個里程碑獨立可驗證、可 review、可 revert。

| # | 內容 | 驗收 |
| :--- | :--- | :--- |
| **A0** | Python 服務骨架：FastAPI + config + `/health` + shared secret + TS 端 client 打通一條 echo 呼叫鏈 | ~~線上可呼叫；Services 路由與環境變數注入正常~~ → **v4 調整為本機可呼叫**（Services 不可用，見〈部署架構〉）；`describe/route.ts` 過期註解已更正；退路步驟寫入 `docs/deployment.md`；CI 兩條 job 綠 |
| **A1** | `agent_steps` migration + Python repository + trace 寫入 | 寫入失敗不中斷主流程 |
| **A2** | `llm/gemini.py`：`generate_structured` 移植 + `generate_with_tools` | 單元測試綠；token 用量正確寫入 `cost_logs` |
| **A3** | 4 個 tool + registry；`/api/internal/pricing/compute`（TS 側） | 各 tool 測試綠；`record_fields` 拒絕自創欄位 |
| **A4** | `agent/loop.py` + budget + fallback；TS 端 fallback 路徑（flag 預設**關**） | 6 種終止條件測試綠；**服務停機下 E2E 仍綠** |
| **A5** | Golden set 移植 + trajectory 標註 + 4 項指標 + `analysis.py` 統計層 | `python -m eval.runner` 產出 15 項指標 + 信賴區間 |
| **A6** | Baseline 對照：flag 關/開各跑一次 | 對照表附 p 值；幻覺率 0%、`fallback_rate` 0% 才可進 A7 |
| **A7** | 商家後台軌跡 UI（TS） | E2E 綠 |
| **A8** | 開 flag + 案例研究文件 | `docs/agent-trajectory-case-study.md` |
| **A9**（選配） | LangGraph 平行實作 + 對照分析 | 同一 golden set 的雙實作對照表 |

**A0 是 v2 新增的前置關卡**。v3 收斂其風險範圍：平台已確定為 Vercel，A0 不再承擔「可能推翻平台選擇」的不確定性，改為驗證 Services 設定是否如文件所述運作。**v4：驗證結果是不可用**，遂啟用既定退路——agent-service 暫不上線，未來拆成第二個 Vercel project，**不影響本文件其餘任何設計**（見〈A0 部署實測〉）。
**A6 是 go/no-go 關卡**：指標未達標就停在 flag 關閉狀態，不硬推。

---

## 待確認事項

1. ~~Python 服務託管平台~~ → ~~v3 定案：單一 Vercel project + Services~~ → **v4 實測推翻，改走退路**：agent-service 暫不部署（本機 + 離線 eval 專用），要上線時拆成第二個 Vercel project。**正式站行為不受影響**（flag 預設關 + fallback）
2. ~~`MAX_AGENT_STEPS = 8`、`MAX_AGENT_LATENCY_MS = 60_000` 為估計值~~ → **A4 實測完成，維持不變**（實測見下方〈A4 實測〉）
3. 「客戶平均被問題數」的 baseline 尚未量測，需在 **A6** 補測 flag 關閉側（A5 已備妥兩側可比的指標管道）
4. ~~`tool_sequence_match_rate` 的比對規則~~ → **A5 定案：忽略查詢類 tool 的連續重複，其餘嚴格比對順序**（理由見下方〈A5 決策〉）
5. 套件管理器：`uv`（快、新，Vercel 明確支援 `uv.lock`）vs `poetry`（穩、普及）——A0 定案
6. `describe/route.ts` 的 `maxDuration` 實際要設多少（180s 為提案值，須權衡「安全網」與「壞掉時使用者要等多久才看到錯誤」）——A0 定案

---

## A0 部署實測（2026-08-17）

v3 的核心部署假設「單一 Vercel project 可同時承載 Next.js 與 Python」**經實測不成立**。三種設定各實際部署一次：

| # | 設定 | 結果 |
| :--- | :--- | :--- |
| 1 | `experimentalServices`（v3 規劃的做法） | Vercel 建置階段直接拒絕：**「`experimentalServices` is no longer available for new projects」** |
| 2 | `services` + `bindings`（現行替代 API） | 建置成功，但**所有路由 404**，含首頁。錯誤為 `Build output contains no "functions" or "static" directory` |
| 3 | **沒有 `vercel.json`** | ✅ `/` 200、`/q/dev` 200、`/api/internal/pricing/compute` 401 |

第 2 項另外揭露兩個與 v3 描述不符之處：

- **`services` 沒有 `mount` 屬性。** v3 假設的「依 URL 路徑前綴路由」不存在；服務位址改由 `bindings` 以環境變數注入到另一個服務。
- **雙向 `bindings` 被拒。** web 需要 agent 的位址、agent 也需要 web 的位址（不變式 I-1 要求計價一律回打 TS 側），但這被判定為 `circular service binding: web -> agent -> web`。改為單向後建置會過，卻卡在上表的路由問題。

**採用第 3 項。** repo 不含 `vercel.json`，正式站維持純 Next.js 部署。

### 為什麼這不是阻礙

`AGENT_LOOP_ENABLED` 預設關閉，`AGENT_SERVICE_URL` 未設定時 `callAgentService` 回 `not_configured`，orchestrator fallback 到 `resolveAfterParse`——**正式站行為與導入 agent 之前逐字元相同**。不變式 I-3 原本是為「服務掛掉」設計的，這裡它承接的是「服務還沒上線」，效果一樣。

agent-service 目前的定位是**本機開發與離線 eval 的執行環境**，不在使用者請求路徑上。A6 的兩側對照本來就在本機跑（需要真實 Gemini 金鑰，本就不會放進 CI），不受此決定影響。

### 學到什麼

v2 誤判平台能力（以為 Vercel 不能跑 Python），v3 反向修正卻誤信了官方文件的另一段（Services 可混合 runtime）。**兩次都是把文件當成已驗證的事實。** 真正救回進度的不是判斷準確，而是 v3 事前把退路寫進 `docs/deployment.md` 並把服務位址放在環境變數——實測翻盤時，程式碼一行都不用改。

> 平台能力隨時在變。涉及部署形式的假設，應在里程碑最前面用一次真實部署驗證，而不是引用文件。

---

## A4 實測（2026-08-16，`agent-service/scripts/verify_agent.py`）

真實 Gemini + 真實 Supabase + 真實計價 API，兩個互補情境各跑一次：

| 情境 | 軌跡 | 步數 | 延遲 | 成本 | 事件 |
| :--- | :--- | ---: | ---: | ---: | :--- |
| 欄位不齊 | `lookup_rate_card → record_fields → ask_customer` | 3 | 3001ms | $0.001288 | `parse_incomplete` |
| 欄位齊全 | `lookup_rate_card → record_fields → compute_quote` | 3 | 1984ms | $0.001152 | `parse_complete` |

**預算常數維持不變。** 實測步數 3 對上限 8，留下的餘裕正好夠一次反問回合後的補記與重算；
延遲與成本則距上限一個數量級以上——刻意如此，三者是防災上限而非目標值，
壓到貼近實測會讓正常變異被誤判成失控。

**成本較原估計高。** budget.py 原本寫「$0.0005 量級」，實測是 $0.0012–0.0013，
約為現行單步流程（$0.000442）的 3 倍。多出來的是多輪 conversation 的重複輸入 token。
這個倍數要進 A6 的 go/no-go 判斷——換到的是「少問幾題」，值不值得由指標決定，不由直覺。

**過程中修掉一個真實缺陷**：loop 原本用 `tool_name`/`args` 重建模型回合再回填
conversation，但 Gemini 3 的 `function_call` part 帶 `thought_signature`，
少了它下一輪會被 API 以 400 INVALID_ARGUMENT 擋下——loop 每次都死在第二輪。
單元測試全綠是因為假 LLM 不驗簽章。改為原樣回填 `ToolTurnResult.model_content`。

> 這正是本腳本存在的理由：**四個 tool 串起來會不會動，只有對真實模型跑過才知道。**

---

## A5 決策（2026-08-16）

實作時偏離了本文件三處，都是往「少一個會壞掉的地方」的方向。

### 1. 期望軌跡用推導，不用人工標註

本文件原規劃人工標註 36 則的期望 tool 序列（估 2–3 小時）。實際上期望序列
**完全由既有標註決定**：

```
lookup_rate_card → record_fields → (missing_required_fields 非空 ? ask_customer : compute_quote)
```

手標等於把 `missing_required_fields` 抄成另一種形式，多養一份會漂移的資料卻不帶
新資訊。改為 `eval/dataset.py::expected_tool_sequence` 推導。規則本身仍是被檢驗的
對象——agent 若跳過 `lookup_rate_card`，序列相符率就會掉。

### 2. 統計層不用 pandas / scipy

三件事標準庫都做得到：Wilson 區間是封閉解、McNemar 精確檢定就是 p=0.5 的二項
檢定（`math.comb`）、常態分位數用 `statistics.NormalDist.inv_cdf`。
**風險表的「bundle 誤含 eval 相依（pandas/scipy）」因此不成立**——不是緩解，是消除。

### 3. Golden set 與欄位契約改為 TypeScript 單向匯出

本文件寫「golden set 移植」，但兩份標註各自維護必然漂移，A6 的對照就會作廢。
改為 `pnpm export:contracts` 從 TypeScript 產生 canonical JSON，CI 以 `--check` 把關。

**這不是假想風險**：A3 移植 `app/agent/fields.py` 時，`coloring_complexity` 的值域被抄成
「線稿/平塗/厚塗」（實際是「精緻上色/簡易上色/線稿」），`license_scope` 抄成
「個人/商業/獨家買斷/有限期限」（實際不含「有限期限」且是「⋯使用」）。前者會讓
**12 則插畫案例的該欄位全數被 `record_fields` 拒收**；後者靠下游的
`normalizeLicenseScope` 僥倖不出錯。單元測試全綠，因為測試把錯誤的值域也寫死了一份。
現由 `tests/test_field_contract.py` 逐項比對匯出檔把關。

### 首次執行（`--limit 3`）

| 指標 | 值 |
| :--- | :--- |
| 欄位抽取準確率 | 93.3% [70.2%, 98.8%]（14/15）|
| tool 序列相符率 | 66.7% [20.8%, 93.9%]（2/3）|
| fallback 率 | 0.0%（0/3）|
| 每案成本 | $0.001186 |
| P95 延遲 | 3140ms |

唯一未通過的是 `graphic-003`：「一整套VI」未抽出 `quantity=1`，agent 因此改問而非
出價。屬模型行為，非程式缺陷——正是這份 eval 該抓到的東西。

> 3 則的區間寬到 [20.8%, 93.9%]，本身就說明了為什麼要印信賴區間。
> 全量 36 則的基準線在 A6 建立。

---

## 查證來源（v3）

平台限制與 Services 機制皆取自 Vercel 官方文件，2026-08-15 查證：

- [Using the Python Runtime with Vercel Functions](https://vercel.com/docs/functions/runtimes/python)（entrypoint 慣例、bundle 控制、Services 指引）
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)（300s 上限、500 MB Python bundle、active CPU 計費）
- [Deploy a FastAPI app on Vercel](https://vercel.com/docs/frameworks/backend/fastapi)（零設定部署）
- [Static Configuration with vercel.json](https://vercel.com/docs/project-configuration/vercel-json)（`experimentalServices`、`functions.excludeFiles`）

> Vercel 的限制數字會隨方案與平台演進調整（v2 的錯誤正是源自過期資訊）。**A0 應重新核對一次上表，不要直接沿用本文件的數字。**
