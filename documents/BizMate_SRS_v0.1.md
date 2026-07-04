# BizMate — Software Requirements Specification (SRS)

**版本**：v0.1
**日期**：2026-07-03
**基於**：BizMate_PRD_v0.2
**風格**：IEEE 830 精簡版
**文件關係**：PRD（產品決策，Why/What）→ **SRS（本文件，需求規格，What 的可驗證版本）** → SAD（架構，How 的高層視圖）→ SDS（細部設計，How 的實作規格）

---

## 1. 簡介

### 1.1 目的
本文件將 PRD 中的產品目標轉譯為**可驗證、可編號、可追溯**的功能需求（FR）與非功能需求（NFR），作為開發、測試與驗收的依據。SAD 與 SDS 中的每個架構元件與設計細節，皆應能對應回本文件的需求編號。

### 1.2 範圍
BizMate 是單一接案者使用的自動化報價系統：客戶透過 Web Wizard 以口語文字描述需求，系統以多 Agent 管線解析並產出可追溯的報價，經接案者透過 LINE Bot 人工終審後，以 Email 寄送最終報價單給客戶。範圍邊界（不做的事）以 PRD §4.2 為準。

### 1.3 名詞定義

| 名詞 | 定義 |
|---|---|
| 客戶 (Client) | 透過 Web Wizard 提交報價請求的訪客，無帳號 |
| 接案者 (Freelancer) | 系統唯一的擁有者/審核者（YC），透過 LINE 互動 |
| Session | 一次完整的報價流程實例，從客戶選擇項目到 Email 寄出 |
| Quote Code | 每張報價的短代碼（如 A-2607001），用於 LINE 端識別 |
| Rate Card | 定價規則表（基礎費率 + 加成係數區間），存於資料庫 |
| Bounded Autonomy | Agent 的決策範圍受人工預設邊界限制的設計原則 |
| HITL | Human-in-the-Loop，人在迴圈 |
| Golden Set | 人工標註的評估測試集 |

### 1.4 參考文件
- BizMate_PRD_v0.2（產品需求）
- BizMate_SAD_v0.1（架構文件）
- BizMate_SDS_v0.2（細部設計）

---

## 2. 整體描述

### 2.1 產品視角
獨立部署的 Web 應用（Vercel）+ 資料庫（Supabase）+ 三個外部服務整合（Gemini API、LINE Messaging API、Gmail SMTP）。不整合個人網站，不依賴任何既有系統。

### 2.2 使用者特性

| 使用者 | 特性 | 介面 |
|---|---|---|
| 客戶 | 不特定大眾，無技術背景，可能提供模糊/不完整的描述 | Web Wizard（免登入） |
| 接案者 | 系統擁有者，熟悉自己的報價邏輯，重視審核效率 | LINE 對話 |
| 面試官/觀眾 | 技術評審視角，關注架構判斷與工程嚴謹度 | Demo + Dashboard |

### 2.3 設計約束
- **C-1**：全系統須可部署於 Vercel 免費層（Hobby）+ Supabase 免費層（PRD §14.1 #4）
- **C-2**：LLM 僅使用 Gemini API，且優先使用具免費層額度的 Flash 系列（PRD §14.1 #2）
- **C-3**：接案者端即時通訊僅支援 LINE（PRD §14.1 決策，Discord 因需常駐服務與 C-1 衝突而排除）
- **C-4**：Email 寄送使用接案者專用 Gmail 帳號（PRD §14.1 #9）
- **C-5**：不做帳號系統；客戶端免登入，管理端以 shared secret 保護（SDS §13.2）
- **C-6**：MVP 僅支援中文口語輸入（PRD §4.2）

### 2.4 假設與相依
- **A-1**：接案者的 LINE user_id 於部署設定時取得並綁定（單一接案者假設）
- **A-2**：Rate card 數字由接案者於 Supabase Table Editor 填入；數字未填入前系統可運行但報價金額為空
- **A-3**：Gemini API 免費層額度足以支撐 demo 與個人接案量；額度政策若變更需重新評估 C-2
- **A-4**：一般 Gmail 帳號的每日寄送上限（約數百封）遠大於實際使用量

---

## 3. 功能需求

> 每條需求含驗收準則（AC）。「系統應」= 必要（MVP 範圍）；「系統宜」= 建議（可延後）。

### 3.1 客戶端 Wizard（FR-CW）

**FR-CW-1 案件類型選擇**
系統應在流程第一步提供三種案件類型供客戶單選：平面設計、插畫、網頁設計。
- AC：選擇後建立 session，且後續欄位抽取 schema 依所選類型切換（對應附錄 A 必要欄位清單）。

**FR-CW-2 口語文字輸入**
系統應提供自由文字輸入框接收客戶的口語需求描述，並要求客戶留下聯絡 email。
- AC：送出後 raw_text 與 contact_email 皆持久化；email 格式須通過基本驗證。

**FR-CW-3 階段式流程呈現**
系統應以階段式（wizard）介面呈現流程進度，客戶可明確辨識目前所在步驟。
- AC：五個步驟有可視進度指示；Step 4 之後客戶端僅顯示等待畫面，不顯示金額。

**FR-CW-4 解析狀態回饋**
系統應在 AI 解析期間向客戶顯示處理中狀態。
- AC：客戶端可透過輪詢取得 session 狀態並更新畫面。

### 3.2 欄位抽取（FR-PA）

**FR-PA-1 結構化抽取**
系統應將客戶口語描述抽取為預定義的結構化欄位，每欄位附 confidence 分數與 source_span（原文對應片段）。
- AC：抽取結果僅含該案件類型 schema 內的欄位（附錄 A）；不可自創欄位。

**FR-PA-2 缺漏偵測**
系統應偵測必要欄位的缺漏或低 confidence，並輸出待澄清欄位清單。
- AC：confidence 門檻為可設定值（初始假設值，待 eval 校準，PRD §14.2 #1）。

### 3.3 反問澄清（FR-CL）

**FR-CL-1 單題反問**
系統應在必要欄位缺漏時，一次向客戶提出一個自然語言問題，優先詢問影響金額最大的欄位（優先序：授權範圍 > 交期 > 修改次數）。
- AC：每輪僅一題；target_field 必為待澄清清單成員。

**FR-CL-2 輪數上限**
系統應限制全流程反問輪數上限（初始值 2-3 輪，可設定）。
- AC：達上限後不再反問，進入 FR-CL-3 的保守估價。

**FR-CL-3 保守估價 Fallback**
系統應在反問輪數用盡仍有欄位不明時，以最低風險假設估價（例如授權範圍預設個人使用），並於報價預覽明確標示「保守估算」。
- AC：標示可被接案者於 LINE 預覽中看見。

### 3.4 報價推理（FR-PR）

**FR-PR-1 基礎費率查表**
系統應依抽取欄位以 deterministic 查表方式計算基礎費率，不經 LLM。
- AC：基礎費率項目的 rule_id 可回溯至 rate_card_base 的具體資料列。

**FR-PR-2 區間內加成判斷**
系統應允許 Pricing Agent 對模糊係數（急件、複雜度等）在 rate_card_modifiers 預設區間內判斷加成幅度。
- AC：任何 agent 產出的加成金額換算為係數後必落在 [range_min, range_max] 內；系統應在寫入前做程式層驗證（非僅依賴 prompt），超界即拒絕寫入並記錄。

**FR-PR-3 超界轉人工**
系統應在請求內容超出 rate card 涵蓋範圍時，標記「需人工報價」而非產出猜測金額。
- AC：out_of_scope 案件的 LINE 推播含明確人工評估標示，金額欄留空。

**FR-PR-4 可追溯性**
系統應為每個報價項目儲存 source_span、rule_id/modifier_id、agent_reasoning、confidence。
- AC：接案者可從任一報價項目回answers「這個數字怎麼來的」（PRD §3.1）。

### 3.5 LINE 終審（FR-LN）

**FR-LN-1 強制終審推播**
系統應在每張報價預覽產出後推播至接案者 LINE，未經接案者確認不得寄出。
- AC：不存在任何繞過終審直接寄送的程式路徑。

**FR-LN-2 Quote Code 識別**
系統應為每張報價配發唯一 quote_code，並顯示於推播訊息與 Quick Reply postback data 中。
- AC：quote_code 全域唯一；postback 動作永遠攜帶明確 code。

**FR-LN-3 口語修改指令**
系統應解析接案者的自由文字回覆為結構化調整動作（改金額/加註記），套用後重新推播更新版預覽。
- AC：調整僅限既有項目；無法解析的指令回覆「無法自動處理」且不變更任何項目。

**FR-LN-4 並發歸屬判斷**
系統應支援多組報價同時待確認：postback 依 code 直接歸屬；自由文字依「目前聚焦 session」歸屬；無聚焦且多組待確認時，以 Quick Reply 清單請接案者先選擇。
- AC：任何一則接案者訊息的歸屬 session 判斷是 deterministic 的（不經 LLM）。

**FR-LN-5 確認與寄出**
系統應在偵測到確認意圖（postback 確認按鈕，或自由文字明確確認語）後，將最終報價單 Email 寄給客戶，並於 LINE 回覆寄出確認。
- AC：寄出後 quote 狀態轉為 sent，同一張報價不可重複寄出。

**FR-LN-6 修改輪數不設限**
系統應允許接案者不限輪數地修改（PRD §14.1 #8），但每輪成本記錄於 cost_logs。
- AC：dashboard 可查詢單張報價的修改輪數與累積成本。

### 3.6 Email 寄送（FR-EM）

**FR-EM-1 最終報價單寄送**
系統應在接案者確認後，將含逐項金額與總計的報價單，寄至客戶於 Step 2 留存的 email。
- AC：信件不含金流連結（PRD §4.2）；寄送失敗須記錄且可人工重送。

### 3.7 Eval（FR-EV）

**FR-EV-1 Golden Set 管理**
系統應以版本化檔案管理 30-50 則人工標註測試案例（涵蓋完整資訊、缺漏欄位、out-of-scope 三類）。
- AC：golden set 存於 repo 並可用版本控制追蹤變更。

**FR-EV-2 批次評估**
系統應提供批次評估腳本，對真實 agent pipeline（非 mock）執行 golden set 並計算 PRD §8.2 全部指標。
- AC：每次評估結果寫入 eval_runs 並標記 dataset_version 與 model_version。

**FR-EV-3 Eval Dashboard**
系統應提供 dashboard 呈現評估指標的彙總與跨次比較。
- AC：可比較不同 model_version / dataset_version 的指標差異。

### 3.8 FinOps（FR-FO）

**FR-FO-1 成本逐筆記錄**
系統應在每次 LLM 呼叫後記錄 token 用量、模型、換算成本與耗時。
- AC：cost_logs 每筆含 input_tokens、output_tokens、cost_usd、latency_ms。

**FR-FO-2 模型分層**
系統應依任務複雜度分層使用模型：輕量任務（抽取/反問/修改解析）用 Flash-Lite；複雜推理（報價）用 Flash 旗艦款。
- AC：cost dashboard 可呈現各模型使用分布。

**FR-FO-3 免費層額度追蹤**
系統應追蹤每日 API 呼叫量並在 dashboard 對照免費層上限顯示。
- AC：當日用量百分比可視。

**FR-FO-4 預算護欄**
系統應在單一 session 累積成本超過門檻時記錄護欄事件（記錄但不阻擋終審流程）。
- AC：護欄觸發次數呈現於 dashboard。

---

## 4. 非功能需求

**NFR-1 延遲**：客戶端單次解析回應（Step 3 首次抽取，或每輪反問後的重新抽取）應 < 5 秒（PRD §12）。
**NFR-2 端到端時效**：從客戶送出描述到 LINE 推播完成，在無反問情況下應 < 3 分鐘（PRD §3.1，不含人工審核）。
**NFR-3 平台約束**：所有 serverless function 單次執行時間須低於 Vercel Hobby 上限的保守估計值；每個 function 僅做單一 LLM 呼叫（SDS §10 設計原則）。
**NFR-4 可觀測性**：每個 agent 呼叫有結構化紀錄（輸入摘要、輸出、latency_ms、成本）。
**NFR-5 安全—Webhook**：LINE webhook 必須通過 X-Line-Signature HMAC 驗證，失敗回 401。
**NFR-6 安全—管理端**：eval/cost dashboard 與 admin API 須以 shared secret 保護，不可完全公開。
**NFR-7 安全—濫用防護**：公開的 session 建立端點須有 rate limiting（同一 IP 每小時上限）。
**NFR-8 安全—Prompt Injection 韌性**：即使客戶輸入含指令注入，最終金額仍受 FR-PR-2 的程式層區間驗證約束，且必經 FR-LN-1 人工終審。
**NFR-9 隱私**：demo 與測試資料一律虛構，不含真實客戶個資。
**NFR-10 冪等性**：LINE webhook 事件以 webhookEventId 去重，同一事件不重複套用。
**NFR-11 可維護性—定價與程式分離**：rate card 修改僅需改資料庫內容，不需重新部署。

---

## 5. 外部介面需求

| 介面 | 方向 | 協定 | 需求 |
|---|---|---|---|
| 客戶 Web Wizard | 客戶 → 系統 | HTTPS (REST) | 免登入；API 合約見 SDS §5.1 |
| LINE Messaging API | 雙向 | HTTPS (Push/Webhook) | Push 推播 Flex Message；Webhook 接收 text/postback；簽章驗證（NFR-5） |
| Gemini API | 系統 → Google | HTTPS | 全部呼叫使用 structured output（responseSchema）；回應須含 usageMetadata 供 FR-FO-1 |
| Gmail SMTP | 系統 → Google | SMTP (App Password) | 僅寄出，不收信 |
| Supabase | 系統 → DB | Postgres / REST | Service role key 僅存於伺服器端環境變數 |

---

## 6. 需求追溯矩陣

| 需求群 | PRD 來源 | SAD 對應 | SDS 對應 |
|---|---|---|---|
| FR-CW-* | §5 Step 1-4 | 容器圖 Web Wizard | §5.1 API |
| FR-PA-* | §6.2 Intake Parser | 元件圖 Agent 層 | §6.1 |
| FR-CL-* | §7.1 Touchpoint 1 | 元件圖 Agent 層 | §6.2、§4 狀態機 |
| FR-PR-* | §6.2-6.4、附錄 A | 元件圖 Agent 層 + ADR-3 | §6.3-6.4、§3.3 |
| FR-LN-* | §5 Step 4-5、§7.2 | 容器圖 LINE 整合 + ADR-5 | §7、§6.5 |
| FR-EM-1 | §5 Step 5、§10 | 容器圖 Email | §8 |
| FR-EV-* | §8 | 容器圖 Eval | §10 |
| FR-FO-* | §9 | 元件圖 cross-cutting | §11、§3.6 |
| NFR-1~4 | §12、§3.1 | 品質屬性場景 QA-1/QA-2 | §14 |
| NFR-5~8 | —（SDS 補強，PRD 隱含） | 品質屬性場景 QA-3 | §13 |
| NFR-9~11 | §12、§14.1 #3 | ADR-4 | §3.3、§12 |

> 註：NFR-5~8 為 SDS 撰寫時識別出的安全需求，PRD 未明文列出但屬於「負責任的公開部署」隱含要求，本 SRS 將其正式化為需求。

---

*此為 v0.1，對應 PRD v0.2 / SDS v0.2（含本次一致性修正）/ SAD v0.1。需求變更時四份文件應同步更新。*
