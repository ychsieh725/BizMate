# BizMate — 自動化報價系統 PRD

**版本**：v0.2（架構決策確認版）
**日期**：2026-07-03
**作者**：YC
**狀態**：多數第 14 章決策已確認，剩餘項目見第 14.2 節

---

## 1. 專案背景與動機

### 1.1 為什麼做這個專案
接案時最耗心力、也最容易產生糾紛的環節，是把客戶口語化、資訊不完整的需求描述（例如「幫我畫一張角色圖，要可以商用，急件」），轉換成有依據、可追溯的正式報價單。這個轉換過程高度依賴經驗判斷，也正好是展示「AI 處理模糊/非結構化資料能力」的理想題材。

### 1.2 作品集定位
這是與 **CareLoop**（團隊 capstone、複雜系統整合）、**ReconLoop**（deterministic state machine 導向）互補的第三個作品，用來展示：

| 能力 | 展示重點 |
|---|---|
| 模糊資料處理 | 口語文字 → 結構化欄位抽取 |
| 多 Agent 編排 | Orchestrator + 專職 Agent 分工，而非單一大 prompt |
| Bounded Autonomy | Agent 可自主決策的範圍有明確邊界，超出邊界必須交人 |
| HITL 介面設計 | 解析階段的主動反問機制（非事後校對） |
| Eval 方法論 | Golden set、可視覺化 dashboard |
| FinOps 成本治理 | 模型分層、成本追蹤、預算護欄 |

三個專案合看，可以講出「我知道什麼時候該用 deterministic、什麼時候該用 agent、什麼時候要人介入」的判斷力故事，這比單一炫技 demo 更有說服力，也呼應你從藝管/設計背景轉職時，UX 與 HITL 介面設計本來就是你的差異化優勢。

### 1.3 使用者
主要使用者是你自己（接案插畫師/設計師），次要使用者是面試官/觀眾（作品集 demo 情境）。兩種使用者都要照顧：前者要求「好用、算得準」，後者要求「看得懂系統在做什麼判斷」。

---

## 2. 專案定位與命名

**專案名稱：BizMate**（已確認）。

**與 QuoteAtelier 的關係**：這是全新獨立規劃，**不**沿用舊版「整合進個人網站」「Vercel+Supabase+Gemini 固定組合」的架構限制。舊版累積的插畫報價業務知識（欄位設計、定價邏輯）仍可參考，但技術架構重新設計。

---

## 3. 目標與成功指標

### 3.1 產品目標
- 客戶從送出口語描述，到系統完成解析、產出報價預覽並推播給接案者，全程 < 3 分鐘（不含客戶回答反問的互動時間）。接案者人工終審的時間不計入——這段等待是刻意設計的品質關卡，不是系統延遲。
- 接案者從收到 LINE 推播到確認寄出，在無需修改的情況下只需點一個按鈕。
- 報價單上每一個金額項目都能回答「這個數字怎麼來的」。

### 3.2 技術展示指標
- Eval dashboard 能呈現：欄位抽取準確率、反問精準率/召回率、報價金額與人工複核基準的偏差。
- FinOps dashboard 能呈現：每張報價單的 token 成本、模型使用分布、預算護欄觸發次數。
- 系統能在面試 demo 中，於 5 分鐘內完整展示：1 個 happy path、1 個觸發反問的 case、eval dashboard、cost dashboard。

### 3.3 非目標（見第 4.2 節）

---

## 4. 範圍

### 4.1 In Scope
- 階段式（wizard）輸入介面，仿機票/飯店訂購流程
- 口語文字 → 結構化欄位抽取（多 agent）
- 資訊不足時的主動反問（HITL，bounded 輪數）
- 依規則 + agent 判斷產出報價單，每項可追溯
- 支援同時處理多組待確認報價（LINE 端 quote code + session 聚焦機制，見第 5、6 章）
- Eval 框架與 dashboard
- 成本追蹤與 FinOps dashboard
- 雲端部署（前端 + 雲端 LLM API）

### 4.2 Out of Scope / Non-Goals
- **不**串接金流（付款仍由使用者自行處理，系統僅負責報價金額與內容的產生、審核、送出）
- **不**整合個人網站或作品集頁面
- **不**做多人協作/權限管理（單一接案者，非多租戶——「同時處理多組報價」指的是同一位接案者面對多個並發客戶案件，不是多位接案者共用系統）
- **不**做多語系（先支援中文口語輸入）
- Touchpoint 2（LINE 終審，見第 7 章）是本專案刻意設計的強制人工關卡，**不是**「事後校對」這種可有可無的 UX 慣例，而是每張報價單對外送出前的必要步驟。

---

## 5. 使用者旅程（客戶端輸入 + 接案者 LINE Bot 即時審核，雙軌流程）

流程分成兩段：**客戶端輸入**（Step 1-3，Web Wizard）與**接案者即時審核**（Step 4-5，透過 LINE Bot 對話）。接案者端改用 LINE 是為了即時性；客戶端最終收到的正式報價單仍以 Email 寄出（因為客戶只在 Web Wizard 留下聯絡信箱，並未加 LINE 好友）。

```
[客戶端 - Web Wizard]
Step1 選擇項目 → Step2 描述案件(文字) + 留下聯絡email → Step3 AI解析中 + 反問(如需要)
                                              │
                                              ▼
                          客戶端畫面顯示「已送出，請等待報價回覆」
                                              │
                                              ▼
                Agent 產出報價預覽 ──▶ LINE Bot 推播訊息通知接案者(你)確認
                                              │
                                              ▼
                        [接案者 - LINE 對話]  Step4 / Step5
                接案者在 LINE 用口語文字回覆修改報價，可重複多輪
                                              │
                                              ▼ (接案者確認)
                    系統將最終報價單 Email 寄給客戶(Step 2 留存的信箱)
```

- **Step 1｜選擇項目**：客戶進站第一步先選擇案件類型 —— 平面設計 / 插畫 / 網頁設計。這個選擇決定後續 Parser Agent 使用的欄位 schema 與對應的 rate card。

- **Step 2｜描述案件**：客戶用口語文字描述需求，並留下聯絡 email（用於接收最終確認報價單）。MVP 階段僅支援文字輸入（暫不做語音）。

- **Step 3｜AI 解析中 + 反問**：Parser Agent 抽取結構化欄位，缺漏/低 confidence 時以對話氣泡向客戶反問，最多 2-3 輪（機制同第 7 節）。

- **Step 4｜送出等待，Agent 產出報價預覽並 LINE 通知接案者**：客戶完成 Step 3 後，畫面顯示「已送出，我們會盡快回覆報價」，**客戶端旅程到此結束**。系統在背景由 Pricing Reasoning Agent 產出報價預覽，透過 LINE Bot 主動推播（push message）給接案者（你），內容包含逐項報價與可追溯依據。

- **Step 5｜接案者透過 LINE 修改與確認**：你直接在 LINE 對話中用口語文字回覆要調整的地方（例如「急件費降到 20% 就好，修改次數改 3 次」）。系統透過 webhook 解析回覆訊息、套用調整，再推播一則更新後的報價預覽給你確認，可重複多輪修改。當你表達確認意圖（例如「OK 可以寄出」），系統將最終報價單直接 Email 給客戶（Step 2 留存的信箱），並在 LINE 回覆你一則「已寄出」確認訊息，流程結束。

> **註 1**：Step 5 的「接案者確認」是本專案真正的人工終審關卡，詳見第 7 章。
> **註 2**：系統支援**同時處理多組**待確認報價。每張報價預覽推播時附上獨立的**報價代碼**（如 A-1024）與 Quick Reply 按鈕（「確認寄出」/「我要修改」），按鈕點擊一律攜帶明確代碼、不會有歧義；只有你直接用**自由文字**回覆時，系統才需要判斷你指的是哪一張——這時系統依你「目前聚焦」的報價套用調整，若還沒聚焦任何一張，會先用 Quick Reply 請你選一張。詳見第 6 章架構圖與第 7.2 節。

---

## 6. 系統架構（Multi-Agent Orchestration）

### 6.1 架構原則
延續你在 CareLoop 已經驗證過的判斷：**能 deterministic 就不要用 agent**。Orchestrator 是一個明確的狀態機（非 LLM），只有在「抽取資訊」「生成反問」「判斷是否落在報價邊界內」「解析接案者的口語修改指令」這類本質模糊的任務才交給對應的 agent。

```
客戶端輸入 (Web)
   │
   ▼
[Orchestrator：deterministic state machine]
   │
   ├─▶ [Intake Parser Agent] ── 抽取結構化欄位 + confidence
   │         │
   │         ▼ (缺必要欄位 or confidence 低)
   │   [Clarification Agent] ── 生成 1 個反問（bounded：只能問預定義欄位）
   │         │
   │         ▼ (客戶回答 → 回到 Parser 重新抽取)
   │
   ├─▶ [Pricing Reasoning Agent] ── 在規則邊界內做複雜度判斷（見 6.3）
   │
   └─▶ [Quote Formatter]（deterministic）── 產出報價預覽 + 配發獨立 quote_code
             │
             ▼
   [LINE Push Dispatcher]（deterministic）── 推播報價預覽（含 quote_code + Quick Reply 按鈕）
             │
             ▼
   [Session Router]（deterministic）── 依「按鈕 postback 的 quote_code」或「目前聚焦 session」
             │                         判斷這則訊息歸屬哪一張報價（支援多組並發，見第 5 章）
             ▼
   [LINE Revision Agent] ── 在已判定的 session 範圍內解析口語回覆 → 結構化調整動作（見 6.3）
             │
             ├─▶ (未確認) 更新該 session 的 price_line_items → 重新產出預覽 → 再次推播（迴圈）
             │
             ▼ (該 session 接案者確認)
   [Email Dispatcher]（deterministic，經接案者專用 Gmail 帳號寄出）── 將最終報價單寄給客戶（Step 2 留存信箱）
```

### 6.2 Agent 角色表

| Agent | 職責 | 模型層級（建議） | 自主邊界 |
|---|---|---|---|
| Orchestrator | 狀態機，決定下一步、輪數控管、逾時 fallback | 無（純程式邏輯） | 全 deterministic |
| Intake Parser Agent | 口語文字 → 結構化欄位（案件類型、用途、數量、交期、修改次數、授權範圍等）+ 每欄位 confidence | 輕量模型（快、便宜） | 只能填預定義 schema，不可自創欄位 |
| Clarification Agent | 針對缺漏/低 confidence 欄位生成 1 個自然語言問題 | 輕量模型 | 只能從預定義欄位清單中選題，每輪最多問 1 題，全流程最多 2-3 輪 |
| Pricing Reasoning Agent | 在 rate card 基礎上，對「急件加成」「複雜度加成」等模糊係數做判斷 | 較強模型（推理成本較高） | 加成幅度必須落在 rate card 預先定義的區間內（例如急件加成 20%-50%），超出區間強制轉人工 |
| Quote Formatter | 套用模板產出報價預覽/正式報價單 | 無（deterministic） | 全 deterministic |
| LINE Revision Agent | 解析接案者在 LINE 的口語文字回覆，轉換成對 `price_line_items` 的結構化調整（改金額、改數量、加註記），並偵測確認意圖 | 輕量模型 | 只能修改既有項目，不能新增規則表未涵蓋的服務項目；偵測到指令超出可解析範圍時，回覆「無法自動處理，請直接於報價項目手動調整」而非硬猜 |

> 模型層級已確認採用 Gemini API（見第 10 章），這裡先定架構角色與分工。此外，**Session Router** 是純 deterministic 的路由邏輯（非 LLM agent），負責在同時有多組報價待確認時，判斷一則 LINE 訊息該套用到哪個 session；詳見第 6.1 架構圖與第 7.2 節。

### 6.3 Bounded Autonomy 規則（核心展示重點）

| 決策類型 | 誰決定 | 邊界 |
|---|---|---|
| 基本費率（依案件類型/尺寸/數量查表） | Deterministic 規則 | 無彈性，直接查表 |
| 急件加成、複雜度加成 | Pricing Agent | 幅度限制在 rate card 定義的區間內（例如 20%-50%），區間本身由人工預先設定，agent 不能改區間 |
| 授權範圍解讀（商用/個人/媒體範圍） | Parser Agent 抽取 + 規則對照 | 若原文未明確授權範圍 → 強制觸發反問，不允許 agent 自行假設 |
| 超出 rate card 涵蓋範圍的特殊案件（例如客戶要求罕見交付格式） | 人工 | Agent 偵測到規則表無對應項目時，直接標記「需人工報價」，不猜測金額 |
| 接案者透過 LINE 的口語修改指令 | LINE Revision Agent | 只能調整已存在的報價項目（金額、數量、備註），不能新增規則表未涵蓋的項目；偵測到超出可解析範圍的指令時，標記「無法自動處理」並保留原項目不變 |

這張表本身就是面試時最好的素材：清楚說明「哪裡讓 agent 自由發揮、哪裡完全鎖死、鎖死的理由是什麼」。表中各項區間的實際定義（三種案件類型各自的維度與 TBD 數值）見附錄 A。

### 6.4 Traceability（有跡可循）設計
每一個報價項目儲存以下 metadata，並在 UI 上可展開查看：
- `source_span`：對應到使用者原始輸入或反問回答的文字片段
- `rule_id`：套用的 rate card 規則編號（若為 deterministic 部分）
- `agent_reasoning`：若為 Pricing Agent 判斷，記錄簡短判斷理由
- `confidence`：該欄位/項目的信心分數

---

## 7. HITL 設計（本專案的兩個 HITL 展示重點）

### 7.1 Touchpoint 1｜客戶端解析反問（Step 3）
- **觸發條件**：Parser Agent 對必要欄位（案件類型、用途/授權範圍、交期、數量）的 confidence 低於門檻，或該欄位完全缺漏。
- **反問方式**：對話氣泡插入 Step 3 畫面，一次只問一題，優先問「影響金額最大」的欄位（例如授權範圍 > 交期 > 修改次數）。
- **輪數上限**：全流程最多 2-3 輪反問，這本身也是 bounded autonomy 的一種展現 —— 避免 agent 無限反問造成客戶疲勞。
- **Fallback**：超過輪數上限仍不明確時，採保守估價（以最低風險假設計算，例如預設個人使用而非商用），並在報價預覽上明確標示「此項目為保守估算」。

### 7.2 Touchpoint 2｜接案者 LINE 終審（Step 4-5，核心關卡）
- **觸發條件**：**每一張報價單都強制觸發**——這不是「有問題才問」的反問，而是刻意設計的強制終審關卡：報價未經接案者確認，不會對客戶送出。
- **互動方式**：LINE Bot 主動推播報價預覽（逐項金額 + 可展開依據 + quote_code + Quick Reply 按鈕），接案者可點按鈕，也可用口語文字自由回覆調整意圖，例如「急件費降到 20%」「這個案子加收版權買斷費用」。
- **輪數**：不設嚴格上限（終審關卡本來就該讓接案者改到滿意為止），但每輪都會記錄進 `cost_logs`（見第 9 章），dashboard 上可看到單張報價單來回修改了幾輪、花了多少 token 成本。
- **確認機制（已確認）**：**Quick Reply 按鈕 + 自由文字並存**。按鈕動作（「確認寄出」/「我要修改」）一律攜帶明確的 quote_code，不會有歧義；自由文字回覆則套用在「目前聚焦」的報價上（見第 6.1 架構圖的 Session Router）。這個設計同時解決「確認意圖誤判」與「多組報價並發時的歸屬判斷」兩個問題。
- **並發報價（已確認支援）**：系統可同時處理多組待確認報價，各自獨立的 quote_code、獨立修改歷程、獨立確認狀態，彼此不互相阻塞。
- **兩個 touchpoint 的差異，是很好的面試素材**：Touchpoint 1 是「AI 不確定時才問人」，Touchpoint 2 是「不管 AI 多確定，都要人點頭」——分別對應「降低使用者負擔」與「業務風險控管」兩種不同的 HITL 設計動機。

---

## 8. Eval 方法論

### 8.1 Golden Test Set
- 手動撰寫 30-50 則模擬客戶口語描述（涵蓋：資訊完整案例、缺 1-2 個關鍵欄位案例、edge case 如超出 rate card 範圍案例），每則附上人工標註的「正確結構化欄位」與「合理報價區間」。

### 8.2 評估指標

| 指標 | 說明 |
|---|---|
| 欄位抽取準確率 / F1 | Parser Agent 抽取結果 vs 人工標註 |
| 反問精準率/召回率 | 該問的時候有沒有問、不該問的時候有沒有亂問 |
| 報價偏差 | Agent 產出金額 vs 人工複核基準的差距（%） |
| Hallucination rate | Agent 是否編造原文未提及的資訊 |
| 端到端成功率 | 完整走完流程且無需人工完全接手的比例 |
| 延遲 | 各 agent 呼叫與端到端總時間 |
| 每案成本 | 見第 9 節 |

### 8.3 Eval Dashboard
呈現上述指標的彙總與趨勢（例如調整 prompt/模型後的前後比較），比照你在 CareLoop 已經設計過的 golden test 框架精神，讓「有做 eval」這件事可視覺化、可展示。

---

## 9. FinOps 成本治理

- **成本追蹤粒度**：每次 agent 呼叫記錄 token 用量、模型、單價、換算成本，寫入 `cost_logs`。
- **模型分層策略**：簡單抽取任務走輕量/低成本模型，複雜推理（Pricing Agent）才動用較強模型 —— 這個分層本身就是 FinOps 治理的具體展示，也呼應 CareLoop 的 cascade 分流精神。
- **免費層額度追蹤**：Gemini API 的 Flash 系列在免費層有每日請求數上限，dashboard 應顯示當日已用量 vs 額度，避免無預警超出免費額度轉為計費（見第 10 章）。
- **預算護欄**：單次報價流程設定成本上限，超過時自動降級到更便宜的模型或轉人工，並記錄觸發事件。
- **接案者修改輪次成本**：Touchpoint 2（LINE 終審）不設嚴格輪數上限，多輪修改可能墊高單張報價單成本；建議在 dashboard 標示單張報價單累積成本，超過軟性門檻時提示（而非阻擋，因為終審決策權在人）。
- **Dashboard 呈現**：每張報價單成本、模型使用分布、累積花費、護欄觸發次數。

---

## 10. 技術棧（已確認）

| 層 | 選項 |
|---|---|
| 前端 | Next.js（wizard 多步驟 UI），部署於 Vercel |
| Orchestration/API | **Next.js API Routes（Vercel Serverless Functions）**，以 Vercel 免費層（Hobby）可部署為核心考量，不另立獨立後端。設計原則：每個 function 只做「單一 agent 呼叫 + 寫回 Supabase」這種短任務，狀態全存在 Supabase，跨步驟由下一次呼叫（使用者互動或 LINE webhook 觸發）接續，避免撞到免費層的執行時間上限（Hobby 方案有秒級的單次執行上限，實際數值以你申請當下 Vercel 官方文件為準，開發時抓保守值設計） |
| 接案者即時通訊 | LINE Messaging API（Push Message 推播報價預覽 + Webhook 接收文字/按鈕回覆），Webhook 掛在 Vercel API Route，無需常駐服務 |
| 客戶端最終通知 | 接案者專用 Gmail 帳號，透過 Nodemailer（SMTP + App Password）或 Gmail API 寄送最終確認報價單。註：一般 Gmail 帳號每日寄送量有上限（約數百封/天），demo 與個人接案量遠低於此，暫不構成問題；若之後量大，可再評估換成 Google Workspace 或轉 Resend/Postmark |
| 資料庫 | Supabase（Postgres），存 session、抽取結果、報價項目、修改歷程、eval 紀錄、cost log |
| LLM API | **Gemini API（已確認）**。輕量任務（Intake Parser、Clarification、LINE Revision）建議用 Flash-Lite 系列；推理較重的 Pricing Reasoning Agent 建議用 Flash 系列的旗艦款（目前中高階 Flash 已能提供接近 Pro 等級的推理品質、同時維持 Flash 價格，且 Flash 系列仍有免費層額度，可先不動用需付費的 Pro 系列）。確切模型版本代號在開發啟動時再依 Google 官方當時的可用清單挑選，因為版本更迭快，寫死在 PRD 容易過時 |
| 部署 | Vercel（前端 + API）+ Supabase 免費層 |

**設計原則備忘**：Rate card（附錄 A）刻意設計成 Supabase 資料表（`rate_card_base` / `rate_card_modifiers`），而不是寫死在程式碼裡——這樣你之後調整報價數字，只需要改資料庫內容，不需要重新部署，也呼應「讓你自己調整架構並填入報價」的需求。

---

## 11. 資料模型（草案）

| 資料表 | 主要欄位 |
|---|---|
| `sessions` | id, created_at, status, current_step |
| `raw_inputs` | session_id, raw_text, timestamp |
| `rate_card_base` | category(平面設計/插畫/網頁設計), subtype, unit, base_price（見附錄 A） |
| `rate_card_modifiers` | category, modifier_name, trigger_condition, range_min, range_max（見附錄 A） |
| `extracted_fields` | session_id, field_name, value, confidence, source_span |
| `clarification_turns` | session_id, round, question, answer, triggered_field |
| `price_line_items` | session_id, item_name, amount, rule_id, agent_reasoning, confidence |
| `revision_turns` | session_id, round, channel(LINE), raw_message, parsed_action, applied_at |
| `line_binding` | freelancer_line_user_id, active_session_id（目前聚焦的報價，MVP 假設單一接案者） |
| `quotes` | session_id, quote_code（推播與 Quick Reply 用的短代碼）, final_amount, status(草稿/待接案者確認/已確認/已寄出), pdf_url |
| `eval_runs` | run_id, dataset_version, metric_name, value, model_version, timestamp |
| `cost_logs` | session_id, agent_name, model, input_tokens, output_tokens, cost_usd |

---

## 12. 非功能需求
- **延遲預算**：Step 3 解析（含至多 1 輪反問前的首次抽取）建議 < 5 秒，避免使用者等待焦慮。
- **可觀測性**：每個 agent 呼叫皆有結構化 log（輸入摘要、輸出、耗時、成本），供 eval 與 debug 使用。
- **隱私**：demo 資料不含真實客戶個資，測試案例皆為虛構或去識別化。

---

## 13. 里程碑建議（對齊 CareLoop Aug 15 死線）

| 階段 | 內容 | 建議時間 |
|---|---|---|
| P0 | Wizard UI + 單一 Parser Agent + deterministic 報價（無反問、無 eval） | CareLoop 死線後 1-2 週 |
| P1 | 拆出 Clarification Agent + Pricing Reasoning Agent + bounded autonomy 規則落地 | +1-2 週 |
| P2 | Eval dashboard + Golden set | +1 週 |
| P3 | FinOps cost dashboard + 模型分層 | +1 週 |

CareLoop 是目前的主線，建議 BizMate 在 8/15 之後再啟動，避免資源分散。

---

## 14. 關鍵決策記錄與剩餘待確認事項

### 14.1 已確認決策

| # | 項目 | 決策 |
|---|---|---|
| 1 | 命名 | **BizMate** |
| 2 | LLM Provider | **Gemini API**（輕量任務用 Flash-Lite，複雜推理用 Flash 旗艦款，見第 10 章） |
| 3 | Rate card 細節 | 結構已定案於**附錄 A**，設計成 Supabase 資料表（非寫死程式碼），數字由你陸續填入，不影響架構 |
| 4 | 後端型態 | **Next.js API Routes（Vercel Serverless Functions）**，以免費層可部署為核心考量，見第 10 章設計原則 |
| 5 | LINE Official Account 設置 | 開發到需要串接時再跟你要帳號資訊，不影響現階段架構設計 |
| 6 | 並發報價 | **需支援同時處理多組**，已於第 5、6、7 章加入 quote_code + Session Router 機制 |
| 7 | 確認機制 | LINE 端採 **Quick Reply 按鈕 + 自由文字並存**（見第 7.2 節） |
| 8 | 接案者修改輪數 | **不設嚴格上限**，僅在 dashboard 追蹤成本（見第 9 章） |
| 9 | 客戶端 Email 服務 | 使用你新申請的**接案專用 Gmail 帳號**寄送（見第 10 章） |

### 14.2 剩餘待確認事項

1. **Clarification 輪數上限與 confidence 門檻的實際數值**：這不是一個可以現在拍板的決策，而是需要先有 golden set 資料才能校準的數字——先沿用「最多 2-3 輪」的假設值開發，之後依 eval 結果調整。
2. **是否需要簡易帳號系統**：先前假設不需要（demo 導向、單一接案者），這次沒有提到異動，先維持「不需要」的假設；如果之後有其他想法再跟我說。

---

## 15. 展示敘事骨架（面試話術）

三個技術判斷力故事點，供你之後準備 demo/面試素材：
1. **「我知道什麼時候不該用 LLM」**：報價單的模板渲染、基本費率查表全部 deterministic，只有真正模糊的部分才交給 agent。
2. **「Agent 的自由度是我設計出來的，不是它自己長出來的」**：bounded autonomy 規則表，讓每個 agent 的決策空間都可解釋、可稽核。
3. **「我不只做出來，還量測它做得好不好、花多少錢」**：eval dashboard + FinOps dashboard，證明工程嚴謹度而非只是 demo 好看。

---

## 附錄 A｜Rate Card 結構骨架（案件類型 × 定價維度）

本附錄定義 Pricing Reasoning Agent 與 Quote Formatter 依賴的定價結構。**數字全部為佔位符（TBD），實際費率由你之後填入**；這裡先固定「維度長什麼樣子」，讓第 6.3 章 bounded autonomy 的邊界、第 8 章 golden set 的標註、第 11 章的資料模型都有依據可以動工。

### A.1 跨案件類型的共用維度
不管平面設計 / 插畫 / 網頁設計，這幾項都會出現，且都由第 7.1 章的反問機制把關：

| 維度 | 說明 | 決策層 |
|---|---|---|
| 用途/授權範圍 | 個人使用 / 商業使用 / 獨家買斷 / 有限期限授權 | Deterministic 查表（依授權等級對應加成倍率，倍率 TBD） |
| 交期 | 標準交期 vs 急件 | 是否急件 deterministic 判斷（門檻天數 TBD），加成幅度交 Pricing Agent 在區間內判斷（區間 TBD，例如 20%-50%） |
| 修改次數 | 報價內含基本修改次數，超出後每次加價 | 基本次數 deterministic 查表（TBD），超出單價 deterministic（TBD） |

### A.2 平面設計 (Graphic Design)

**必要欄位**（Parser Agent 必須抽取，缺漏觸發反問）：子類型（LOGO設計 / 海報文宣 / 品牌識別CI-VI / 社群圖像 / 名片文具）、數量、是否含比稿輪數。

| 子類型 | 計價單位 | 基礎單價 |
|---|---|---|
| LOGO 設計 | 每款 | TBD |
| 海報/文宣 | 每張 | TBD |
| 品牌識別(CI/VI) | 每套（通常含LOGO+應用規範） | TBD |
| 社群圖像 | 每張/每組 | TBD |
| 名片/文具 | 每組 | TBD |

**加成係數**（Pricing Agent 在區間內判斷）：

| 係數 | 觸發條件 | 區間 |
|---|---|---|
| 印刷檔輸出 | 客戶要求印刷用檔案（CMYK/出血/向量檔），非僅螢幕用 | TBD |
| 品牌規範完整度 | 僅 LOGO vs 完整 VI 系統文件 | TBD |

### A.3 插畫 (Illustration)

**必要欄位**：子類型（角色設計 / 單張插畫 / 系列插畫封面內頁 / 貼圖表情包）、張數或角色數、上色複雜度（線稿 / 簡易上色 / 精緻上色）、尺寸解析度需求。

| 子類型 | 計價單位 | 基礎單價 |
|---|---|---|
| 角色設計 | 每角色 | TBD |
| 單張插畫 | 每張 | TBD |
| 系列插畫 | 每張（通常套組折扣） | TBD |
| 貼圖/表情包 | 每組（常見16-24張/組） | TBD |

**加成係數**：

| 係數 | 觸發條件 | 區間 |
|---|---|---|
| 上色複雜度加成 | 精緻上色 vs 簡易上色/線稿 | TBD |
| 高解析度/印刷輸出 | 客戶要求高解析度原檔 | TBD |

### A.4 網頁設計 (Web Design)

**必要欄位**：子類型（Landing Page / 多頁式網站 / 電商網站 / UI-UX設計稿）、頁數、功能模組（會員系統/金流/多語系等，可複選）、是否含RWD、是否含後台CMS。

| 子類型 | 計價單位 | 基礎單價 |
|---|---|---|
| Landing Page | 每頁 | TBD |
| 多頁式網站 | 每頁（通常套組折扣） | TBD |
| 電商網站 | 整案（依功能模組疊加） | TBD |
| UI/UX 設計稿 | 每頁面 | TBD |

**加成係數**：

| 係數 | 觸發條件 | 區間 |
|---|---|---|
| 功能模組複雜度 | 每加一個模組（會員/金流/多語系等） | TBD |
| 是否含前端切版實作 | 客戶要求不只設計稿，還要可上線的前端程式碼 | 已超出「設計」範疇，建議標記為「超出 rate card，需人工評估」，不自動加成 |

### A.5 這份骨架如何餵給系統
- 「基礎定價維度」三張表 → 對應 `rate_card_base` 資料表，deterministic 查表用
- 「加成係數」三張表 + A.1 共用維度 → 對應 `rate_card_modifiers` 資料表，就是第 6.3 章 bounded autonomy 表中「區間本身由人工預先設定」的那個區間的實際來源
- 「必要欄位」清單 → 直接對應 Intake Parser Agent 依案件類型切換的抽取 schema，以及 Step 3 反問機制判斷「缺哪個欄位」的依據

---

*此為 v0.2，第 14.1 章決策已確認；待第 14.2 章剩餘事項與附錄 A 數字填入後，可進入詳細技術規格（API 設計、prompt 設計、資料庫 schema 定案）。*
