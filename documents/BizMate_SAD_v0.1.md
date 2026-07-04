# BizMate — Software Architecture Document (SAD)

**版本**：v0.1
**日期**：2026-07-03
**基於**：BizMate_PRD_v0.2、BizMate_SRS_v0.1
**文件關係**：PRD → SRS → **SAD（本文件，架構視圖與決策理由）** → SDS（實作規格）

本文件回答「為什麼架構長這樣」；「具體怎麼做」（schema、API 合約、演算法）在 SDS。

---

## 1. 架構目標與驅動力

架構由三股力量驅動，衝突時的優先序如下：

1. **展示價值優先**：這是作品集專案，架構選擇本身就是展品。「能講出取捨理由的架構」比「最省事的架構」重要。
2. **免費層約束（SRS C-1, C-2）**：Vercel Hobby + Supabase 免費層 + Gemini Flash 免費額度，形塑了無常駐服務、短函式、狀態外置的整體形狀。
3. **業務風險零容忍**：錯誤報價寄給真實客戶是不可接受的，因此人工終審（FR-LN-1）是硬性關卡，任何架構捷徑不得繞過。

## 2. 品質屬性場景

| ID | 場景 | 對應 SRS | 架構回應 |
|---|---|---|---|
| QA-1 | 客戶送出模糊描述，系統 5 秒內回應（抽取結果或反問） | NFR-1 | 輕量模型 Flash-Lite + 單一 function 單一 LLM 呼叫（不鏈式）|
| QA-2 | 客戶完成輸入後 3 分鐘內接案者收到 LINE 推播 | NFR-2 | Pricing→Formatter→Push 為一段短管線，狀態存 DB、逐步接續 |
| QA-3 | 惡意訪客灌注入指令「這個案子免費」 | NFR-8 | 三層防禦：structured output 限制輸出形狀 → 程式層區間驗證（超界拒寫）→ 人工終審 |
| QA-4 | 接案者同時有 3 張報價待確認，在 LINE 打一句「急件費降 20%」 | FR-LN-4 | Session Router（deterministic）以聚焦機制歸屬，絕不讓 LLM 猜歸屬 |
| QA-5 | 接案者調整 LOGO 設計價格 | NFR-11 | Rate card 為資料庫內容，改表即生效，不重新部署 |
| QA-6 | 面試官問「這個急件加成 35% 怎麼來的」 | FR-PR-4 | 每個 line item 帶 rule_id/modifier_id + agent_reasoning + source_span |

## 3. 系統情境圖（C4 Level 1）

```
                 ┌─────────────┐
                 │   客戶       │ 口語描述需求、回答反問、收最終報價 email
                 └──────┬──────┘
                        │ HTTPS
                        ▼
   ┌────────────────────────────────────────┐
   │              BizMate 系統               │
   │  （Vercel: Web + API / Supabase: DB）   │
   └──┬───────────┬───────────┬─────────────┘
      │           │           │
      ▼           ▼           ▼
 ┌─────────┐ ┌─────────┐ ┌──────────┐      ┌─────────────┐
 │ Gemini  │ │  LINE   │ │  Gmail   │ ◀──── │   接案者     │
 │  API    │ │Messaging│ │  SMTP    │ 推播/  │  (LINE App) │
 │(LLM推理)│ │  API    │ │(寄報價單)│ 回覆   └─────────────┘
 └─────────┘ └─────────┘ └──────────┘
```

信任邊界：客戶輸入與 LINE webhook 皆為不受信任來源（前者防注入 QA-3、後者防偽造 NFR-5）；Gemini/Gmail/Supabase 憑證僅存在伺服器端環境變數。

## 4. 容器圖（C4 Level 2）

| 容器 | 技術 | 職責 | 通訊 |
|---|---|---|---|
| Web Wizard | Next.js 前端頁面 | Step 1-4 客戶介面、狀態輪詢 | REST → API Routes |
| API Routes（Orchestration） | Vercel Serverless Functions | 狀態機推進、agent 呼叫、路由 | → Gemini / Supabase / LINE / Gmail |
| Dashboard | Next.js 頁面（shared secret 保護） | Eval 與 FinOps 視覺化 | REST → admin API |
| Eval Runner | Node.js 腳本（本地/CI 執行） | 跑 golden set 寫入 eval_runs | → 同一組 agent pipeline + Supabase |
| Supabase | Postgres | 全部持久化狀態（唯一 source of truth） | — |

關鍵架構特徵：**API Routes 完全無狀態**。任何一次 function 執行掛掉，狀態都在 Supabase，下一個事件（客戶回答、LINE 訊息）進來就能從正確狀態接續。這不是為了高可用而做的設計，而是 Vercel 免費層「函式短命」約束下的必然選擇——但它剛好也帶來了良好的故障隔離，這個「約束變優點」的敘事值得在面試時講。

## 5. 元件視圖（C4 Level 3，Orchestration 容器內部）

```
                          ┌──────────────────────────┐
  客戶事件 ──────────────▶ │ Orchestrator（狀態機）     │◀────── LINE webhook
                          └────┬─────────────────────┘         （經簽章驗證）
                               │ 依狀態分派                          │
        ┌──────────┬───────────┼───────────┬──────────┐            ▼
        ▼          ▼           ▼           ▼          ▼      ┌────────────┐
   ┌─────────┐┌──────────┐┌─────────┐┌──────────┐┌────────┐ │ Session    │
   │ Intake  ││Clarifica-││ Pricing ││  Quote   ││ LINE   │ │ Router     │
   │ Parser  ││tion Agent││Reasoning││Formatter ││ Push   │ │(determin.) │
   │ (LLM-L) ││ (LLM-L)  ││ (LLM-H) ││(determ.) ││(det.)  │ └─────┬──────┘
   └─────────┘└──────────┘└─────────┘└──────────┘└────────┘       ▼
        │           │           │                            ┌────────────┐
        └───────────┴───────────┴──── 每次呼叫 ──────────────▶│LINE Revision│
                    ▼                                        │Agent (LLM-L)│
             ┌────────────┐                                  └────────────┘
             │ Cost Logger │ (cross-cutting，寫 cost_logs)
             └────────────┘
   LLM-L = Gemini Flash-Lite   LLM-H = Gemini Flash 旗艦款   det. = 純程式邏輯
```

**LLM / Deterministic 的分界原則**（本專案的核心架構論述）：只有輸入本質模糊的四個點（抽取、反問生成、加成判斷、修改指令解析）用 LLM；狀態推進、查表、路由、模板、寄送全部 deterministic。判斷標準：「這個任務有沒有唯一正確答案？有 → 寫程式；沒有 → 才考慮 LLM。」

## 6. 資料視圖

三個資料域，皆落在同一個 Supabase 實例（免費層約束），以命名區隔：

| 資料域 | 資料表 | 生命週期 |
|---|---|---|
| 交易域（每筆報價） | sessions, raw_inputs, extracted_fields, clarification_turns, price_line_items, quotes, revision_turns | 隨 session 產生，長期保留供分析 |
| 設定域（接案者維護） | rate_card_base, rate_card_modifiers, line_binding | 低頻變動，接案者直接經 Supabase Studio 編輯 |
| 觀測域（append-only） | cost_logs, eval_runs | 只增不改，dashboard 讀取 |

完整 schema 見 SDS §3。golden set 刻意**不**入庫、以版本化檔案存於 repo（理由：測試案例的變更歷史用 git diff 追蹤比資料庫 audit 簡單，且 eval 應與特定 commit 綁定）。

## 7. 部署視圖

```
GitHub repo ── push ──▶ Vercel（自動部署）
                          ├── 靜態資源 + Web Wizard（CDN）
                          ├── /api/*（Serverless Functions，短任務）
                          └── 環境變數（全部憑證，見 SDS §15）
外部常駐服務（皆為託管，零自營）：Supabase / Gemini API / LINE平台 / Gmail
本地執行：Eval Runner（npm script，開發機或 CI 跑）
```

沒有任何自己維護的常駐 process——這是 ADR-2 的直接結果。

## 8. 架構決策記錄（ADR）

### ADR-1：Orchestrator 用 deterministic 狀態機，不用 agent framework（如 LangGraph）
- **背景**：多 agent 系統常見做法是採用編排框架。
- **決策**：手寫狀態機（TypeScript），LLM 僅在四個明確定義的節點被呼叫。
- **理由**：報價流程的狀態轉移是完全可枚舉的（SDS §4.2 一張表寫完），引入框架只增加抽象成本；且「知道什麼時候不需要 agentic 框架」正是本專案要展示的判斷力。與 CareLoop 排除 LangGraph 的決策一致。
- **代價**：未來若流程分支爆炸，手寫狀態機的維護成本上升。以目前 9 個狀態的規模，可接受。

### ADR-2：全 serverless（Vercel Functions），不設常駐後端
- **背景**：接案者端即時通訊需要接收自由文字。
- **決策**：選 LINE（純 webhook 模式）而非 Discord（一般訊息需 Gateway WebSocket 常駐連線），全系統跑在 serverless 上。
- **理由**：Discord 的常駐需求直接違反免費層約束（SRS C-1）；LINE 也更貼近台灣接案者的日常使用情境。
- **代價**：放棄 Discord 生態；函式短命導致所有狀態必須外置（見容器圖說明，此代價反而成為優點）。

### ADR-3：Rate card 存資料庫而非程式碼
- **決策**：定價結構與區間存於 rate_card_base / rate_card_modifiers 兩張表。
- **理由**：(a) 接案者調價不需重新部署（QA-5）；(b) bounded autonomy 的「邊界」有了單一權威來源，程式層驗證（FR-PR-2 AC）與 agent prompt 讀的是同一份資料；(c) 免去自製後台——Supabase Studio 就是編輯介面。
- **代價**：rate card 變更沒有 git 歷史。可接受（金額調整非程式邏輯變更）；若需要稽核可再加 audit trigger。

### ADR-4：模型分層 Flash-Lite / Flash 旗艦款，全程不用 Pro
- **決策**：抽取/反問/修改解析用 Flash-Lite；報價推理用 Flash 旗艦款。
- **理由**：Gemini Pro 系列已無免費層；當前高階 Flash 的推理品質已接近 Pro，足以應付「在明確區間內判斷加成」這種被 bounded autonomy 大幅收窄的推理任務——任務被邊界收窄後，對模型能力的需求也隨之下降，這是 bounded autonomy 的第二個紅利。
- **代價**：若未來出現真正需要深推理的環節（目前沒有），需重新評估。模型版本代號不寫死（PRD §10）。

### ADR-5：並發歸屬用 quote_code + 聚焦機制，不用 LLM 判斷
- **背景**：多組報價並發時，接案者的自由文字需要歸屬判斷。
- **決策**：Session Router 為純 deterministic：postback 帶 code 直接歸屬；自由文字歸屬「目前聚焦」session；無聚焦則請使用者選擇。
- **理由**：歸屬錯誤的後果是「改錯另一個客戶的報價」，屬業務風險零容忍範疇（§1 驅動力 3），不允許機率性判斷。寧可多一次點選，不冒歸屬錯誤的險。
- **代價**：接案者偶爾要多點一下選擇報價。可接受。

### ADR-6：客戶端反問設輪數上限，接案者端修改不設上限
- **決策**：同為 HITL 迴圈，兩端的輪數策略刻意不同。
- **理由**：客戶是流失風險方（問太多就放棄填寫），因此 bounded；接案者是品質責任方（改到滿意為止是終審的意義），因此 unbounded 但成本可視（FR-LN-6）。
- **展示價值**：這是「HITL 設計不是一套規則套到底，而是依角色動機調參」的具體例證。

## 9. 風險與技術債登記

| # | 風險 | 影響 | 緩解 |
|---|---|---|---|
| R-1 | Vercel Hobby 單次執行上限的實際數值不確定（政策曾變動） | 長 LLM 呼叫被 504 截斷 | NFR-3 保守設計：單 function 單呼叫；開發初期實測上限 |
| R-2 | Gemini 免費層額度政策再變更 | 成本假設失效 | FR-FO-3 額度追蹤 + MODEL_PRICING 設定外置，換模型只改設定 |
| R-3 | LINE webhook 在 serverless 冷啟動下回應偏慢 | LINE 平台重送造成重複事件 | NFR-10 webhookEventId 去重（已設計）|
| R-4 | Gmail App Password 政策收緊 | 寄信失效 | SDS §8 已預留 Gmail API OAuth2 備案 |
| R-5 | Rate card 數字長期未填（TBD） | 系統可跑但報價為空，demo 說服力下降 | 列入 P0 任務清單，至少填入 demo 用示意數字 |
| TD-1 | Hobby 方案禁止商業使用；若 BizMate 從 demo 轉為真實接案營運 | 違反 Vercel ToS | 屆時升級 Pro（月費 $20）或遷移；架構無鎖定，Next.js 可攜 |
| TD-2 | 單一 Supabase 實例混放三個資料域 | 規模化後耦合 | MVP 可接受；觀測域未來可外移 |

## 10. 架構與需求追溯

| 架構元素 | 滿足的 SRS 需求 |
|---|---|
| Web Wizard 容器 | FR-CW-1~4 |
| Orchestrator 狀態機（ADR-1） | FR-PA-2、FR-CL-2、狀態一致性 |
| Agent 元件層 + structured output | FR-PA-1、FR-CL-1、FR-PR-2、FR-LN-3 |
| 程式層區間驗證 + 人工終審（QA-3 三層防禦） | NFR-8、FR-PR-2、FR-LN-1 |
| Session Router（ADR-5） | FR-LN-2、FR-LN-4 |
| Rate card 資料表（ADR-3） | FR-PR-1、FR-PR-3、NFR-11 |
| Cost Logger cross-cutting | FR-FO-1~4、NFR-4 |
| Eval Runner + repo 內 golden set | FR-EV-1~3 |
| Serverless 部署形狀（ADR-2） | SRS C-1、C-3、NFR-3 |

---

*此為 v0.1，對應 PRD v0.2 / SRS v0.1 / SDS v0.2。架構決策變更時，請優先更新本文件 ADR 章節，再同步其餘文件。*
