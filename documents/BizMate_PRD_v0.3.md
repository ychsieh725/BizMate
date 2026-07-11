# BizMate — 多租戶自動化報價 SaaS PRD

**版本**：v0.3（多租戶重構後定案版，取代 v0.2 單一接案者假設）
**日期**：2026-07-11
**作者**：YC
**狀態**：MT-M1～MT-M4 已完成並併入 main；MT-M5（Email 寄送）進行中，MT-M6（收尾）待處理（詳見 §13）

---

## 1. 專案背景與動機

### 1.1 為什麼做這個專案

接案時最耗心力、也最容易產生糾紛的環節，是把客戶口語化、資訊不完整的需求描述（例如「幫我畫一張角色圖，要可以商用，急件」），轉換成有依據、可追溯的正式報價單。這個轉換過程高度依賴經驗判斷，且每個接案者都要重複面對同樣的流程——手動報價耗時、缺乏一致性，也難以在事後回答「這個數字怎麼來的」。

BizMate 要解決的是這個共通痛點：讓任何接案者（設計師、插畫師、工作室）都能透過同一套系統，自主管理自己的服務項目與價格，取得一個可直接分享給客戶的專屬連結，讓客戶自助完成報價流程，接案者只需在後台做最終確認。

### 1.2 使用者

**主要使用者**：註冊使用本系統的商家（接案者/工作室，即租戶）——各自管理自己的服務項目、定價，並在後台終審每一筆報價。

**次要使用者**：商家的客戶——透過商家的專屬連結描述需求、取得報價、收到最終報價單。

兩種使用者的需求不同：商家要求「好用、算得準、看得懂系統在做什麼判斷」；客戶要求「填寫簡單、等待時間短、報價有依據」。

---

## 2. 專案定位與命名

**專案名稱：BizMate**（已確認）。

BizMate 是獨立規劃的多租戶 SaaS，取代舊版「單一接案者、整合進個人網站」的 QuoteAtelier 架構限制。舊版累積的插畫報價業務知識（欄位設計、定價邏輯）仍可參考，但技術架構與產品定位皆重新設計為多人可用的產品。

---

## 3. 目標與成功指標

### 3.1 產品目標

- 客戶從送出口語描述，到系統完成解析、產出報價並寫入商家的報價列表，全程 < 3 分鐘（不含客戶回答反問的互動時間）。商家人工終審的時間不計入——這段等待是刻意設計的品質關卡，不是系統延遲。
- 商家在後台完成「看單 →（可選）調金額 → 確認」，在無需修改的情況下只需點一個按鈕。
- 商家從註冊到取得可用的專屬分享連結，全程 < 2 分鐘（onboarding 自動複製全域範本價目表，不需要從零建立）。
- 報價單上每一個金額項目都能回答「這個數字怎麼來的」。

### 3.2 系統品質指標

- **跨租戶隔離**：每個涉及租戶資料的模組皆有 verify script，對真實 DB 證明商家 A 無法讀取或寫入商家 B 的任何資料（應用層 `requireMerchant` 為主要保證，RLS policy 為第二道防線）。
- **測試覆蓋率**：80%+，TDD 強制執行（見 `testing.md`）。
- **關鍵流程可驗證**：認證、服務管理、報價審核、Email 寄送，皆有對應 verify script 在真實環境（非 mock）驗證行為正確。

### 3.3 非目標

見 §4.2。

---

## 4. 範圍

### 4.1 In Scope

- 商家自助註冊/登入（Supabase Auth）
- 商家自主管理服務項目與價格（onboarding 時自動複製全域範本，加速起步；後續可自行調整，含軟刪除）
- 商家取得專屬分享連結 `/q/{slug}`，供客戶自助完成報價
- 階段式（wizard）客戶輸入介面，仿機票/飯店訂購流程
- 口語文字 → 結構化欄位抽取（多 agent）
- 資訊不足時的主動反問（HITL，bounded 輪數，全流程最多 3 輪）
- 依規則 + agent 判斷產出報價單，每項可追溯
- 商家網頁後台終審：報價列表（狀態篩選）、詳情（明細/抽取欄位/澄清歷程/原始描述）、調整金額、確認
- Email 通知客戶最終報價單（Resend）
- 多租戶資料隔離（應用層守門 + RLS 雙重保證）
- 雲端部署（Vercel Serverless + Supabase 免費層）

### 4.2 Out of Scope / Non-Goals

- **不**串接金流（付款仍由商家自行處理，系統僅負責報價金額與內容的產生、審核、送出）
- **不**做多語系（先支援中文口語輸入）
- **不**做 Eval/FinOps 的視覺化 dashboard——降級為 verify scripts 與 SQL 直查即可滿足「可驗證」的需求，把心力集中在產品核心功能（見 §8、§9）
- **不**做團隊多角色/細粒度權限——每個商家對自己名下的資料擁有完整存取權，不支援同一商家帳號下的多人協作
- **不**支援商家之間的資料共享（範本價目表僅在 onboarding 時單向複製一次，之後各自獨立）
- **LINE 相關整合**（Bot 終審對話、Push 推播、口語修改指令解析）已於 2026-07-07 拍板棄用，改為網頁後台終審。原因：LINE 端點在當時完全未實作（僅存在於 schema 與 env），且終審改後台後不再需要「即時通訊」這個中間層——後台本身就是即時的（詳見 §6、§7）。

---

## 5. 使用者旅程

分成兩段：**客戶端輸入**（`/q/{slug}` Web Wizard）與**商家後台終審**（`/dashboard`）。

```
[商家]
註冊/登入 → onboarding（自動複製範本價目表） → 取得專屬連結 /q/{slug}
                                                        │
                                                        │ 分享連結給客戶
                                                        ▼
[客戶 - /q/{slug} Wizard]
Step1 選擇項目 → Step2 描述案件(文字) + 留下聯絡email → Step3 AI解析中 + 反問(如需要)
                                              │
                                              ▼
                          客戶端畫面顯示「已送出，請等待報價回覆」
                                              │
                                              ▼
                Agent 產出報價 ──▶ 寫入商家的報價列表（狀態：待審 awaiting_review）
                                              │
                                              ▼
                        [商家 - 後台 /dashboard/quotes]
              商家瀏覽報價列表 → 點開詳情（明細/抽取欄位/澄清歷程/原始描述，全程可追溯）
                                              │
                                              ▼ （可選）調整最終金額
                                              │
                                              ▼ 確認
                    系統將最終報價單以 Email 寄給客戶（Step 2 留存的信箱）
```

- **Step 1｜選擇項目**：客戶進站第一步先選擇案件類型——平面設計 / 插畫 / 網頁設計。這個選擇決定後續 Parser Agent 使用的欄位 schema 與對應的該商家價目表。

- **Step 2｜描述案件**：客戶用口語文字描述需求，並留下聯絡 email（用於接收最終確認報價單）。MVP 階段僅支援文字輸入（暫不做語音）。

- **Step 3｜AI 解析中 + 反問**：Parser Agent 抽取結構化欄位，缺漏/低 confidence 時以對話氣泡向客戶反問，全流程最多 3 輪（機制同第 7 節）。

- **Step 4｜送出等待，報價寫入商家後台**：客戶完成 Step 3 後，畫面顯示「已送出，我們會盡快回覆報價」，**客戶端旅程到此結束**。系統在背景完成計價，將報價寫入該商家的報價列表（狀態 `awaiting_review`），逐項金額與可追溯依據皆已存好。

- **Step 5｜商家於後台終審**：商家登入 `/dashboard/quotes`，看到自己的報價列表（可依狀態篩選），點進任一筆看到完整脈絡。若金額需要調整，直接在詳情頁修改（差額以一筆「手動調整」明細列入帳，明細加總恆等於總額，客戶收到的報價信不會出現對不上的數字）。商家按下確認後，系統以 Email 將最終報價單寄給客戶（Step 2 留存的信箱）。

> **註**：多租戶架構下，每個商家只看得到自己的報價列表，商家之間互不可見；同一商家名下的多筆報價各自獨立操作，不需要判斷「這則操作屬於哪一張報價」——這是後台介面（相對於即時通訊介面）的天然優勢。

---

## 6. 系統架構（Multi-Agent Orchestration + 多租戶）

### 6.1 架構原則

**能 deterministic 就不要用 agent。** Orchestrator 是一個明確的狀態機（非 LLM），只有在「抽取資訊」「生成反問」這類本質模糊的任務才交給對應的 agent。

```
商家（Web Dashboard）
   │
   ├─ 註冊/登入（Supabase Auth，@supabase/ssr）
   ├─ 管理服務項目與價格（/dashboard/services）
   └─ 取得專屬連結 /q/{slug}
              │
              ▼
客戶端輸入（Web Wizard，掛在 /q/{slug} 下，入口以 slug 解析商家）
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
   └─▶ [Quote Formatter]（deterministic）── 依該商家價目表查表計價，
             │                              寫入該商家的報價列表（awaiting_review）
             ▼
   [商家後台 /dashboard/quotes]（requireMerchant 守門，租戶隔離主保證）
             │
             ├─▶ 商家瀏覽列表/詳情（歸屬檢查 + 明細/抽取欄位/澄清歷程聚合）
             ├─▶ 商家調整金額（原子 RPC：維持「明細加總 = 總額」不變式）
             └─▶ 商家確認（原子 RPC：同步推進報價與案件狀態 → confirmed）
                       │
                       ▼
   [Email Dispatcher]（deterministic，Resend HTTP API）── 寄送最終報價單給客戶
```

### 6.2 Agent 角色表

| Agent | 職責 | 模型層級（建議） | 自主邊界 |
|---|---|---|---|
| Orchestrator | 狀態機，決定下一步、輪數控管、逾時 fallback | 無（純程式邏輯） | 全 deterministic |
| Intake Parser Agent | 口語文字 → 結構化欄位（案件類型、用途、數量、交期、修改次數、授權範圍等）+ 每欄位 confidence | 輕量模型（快、便宜） | 只能填預定義 schema，不可自創欄位 |
| Clarification Agent | 針對缺漏/低 confidence 欄位生成 1 個自然語言問題 | 輕量模型 | 只能從預定義欄位清單中選題，每輪最多問 1 題，全流程最多 3 輪 |
| Pricing Reasoning Agent（尚未實作，backlog） | 在 rate card 基礎上，對「急件加成」「複雜度加成」等模糊係數做判斷 | 較強模型 | 加成幅度必須落在 rate card 預先定義的區間內，超出區間強制轉人工 |
| Quote Formatter | 套用模板產出報價，寫入該商家的報價列表 | 無（deterministic） | 全 deterministic |

> 模型層級採用 Gemini API（見第 10 章）。Pricing Reasoning Agent 目前尚未實作——現行計價為 deterministic 查表（基礎費率 + 已定義加成規則），複雜度判斷列為 backlog（WBS 6.1-6.2）。

### 6.3 Bounded Autonomy 規則（核心架構決策）

| 決策類型 | 誰決定 | 邊界 |
|---|---|---|
| 基本費率（依案件類型/尺寸/數量查表） | Deterministic 規則 | 無彈性，直接查表；查無對應項目 → `outOfScope`，不猜測金額 |
| 急件加成、複雜度加成 | Deterministic 規則（Pricing Agent 尚未實作） | 幅度限制在該商家 rate card 定義的區間內，區間由商家自行設定 |
| 授權範圍解讀（商用/個人/媒體範圍） | Parser Agent 抽取 + 規則對照 | 若原文未明確授權範圍 → 強制觸發反問，不允許 agent 自行假設 |
| 超出價目表涵蓋範圍的特殊案件 | 人工 | 系統偵測到規則表無對應項目時，直接標記「需人工報價」，不猜測金額 |
| 商家終審時調整金額 | 商家本人 | 後台直接 PATCH `final_amount`，差額由系統自動計入明細，不需要 agent 解析調整指令 |

這張表是核心架構文件：清楚說明「哪裡讓 agent 自由發揮、哪裡完全鎖死、鎖死的理由是什麼」。表中各項區間的實際定義見附錄 A。

### 6.4 Traceability（有跡可循）設計

每一個報價項目儲存以下 metadata，並在後台詳情頁可展開查看：
- `source_span`：對應到使用者原始輸入或反問回答的文字片段
- `rule_id` / `modifier_id`：套用的價目表規則編號（deterministic 部分；兩者恰有一個非 null，商家手動調整的差額列則兩者皆為 null）
- `agent_reasoning`：若為 agent 判斷或商家手動調整，記錄簡短理由
- `confidence`：該欄位/項目的信心分數

---

## 7. HITL 設計

### 7.1 Touchpoint 1｜客戶端解析反問（Step 3）

- **觸發條件**：Parser Agent 對必要欄位（案件類型、用途/授權範圍、交期、數量）的 confidence 低於門檻，或該欄位完全缺漏。
- **反問方式**：對話氣泡插入 Step 3 畫面，一次只問一題，優先問「影響金額最大」的欄位（子類型/數量 > 授權範圍 > 交期 > 修改次數）。
- **輪數上限**：全流程最多 3 輪反問，這本身也是 bounded autonomy 的一種展現——避免 agent 無限反問造成客戶疲勞。
- **Fallback**：超過輪數上限仍不明確時，採保守估價（以現有已知欄位計價），並在報價上明確標示「此項目為保守估算」（`quotes.is_conservative`）。

### 7.2 Touchpoint 2｜商家後台終審（核心關卡）

- **觸發條件**：**每一張報價都強制觸發**——這不是「有問題才問」的反問，而是刻意設計的強制終審關卡：報價未經商家確認，不會對客戶送出。
- **互動方式**：商家於 `/dashboard/quotes` 瀏覽列表（可依狀態篩選），點進詳情看到逐項金額 + 可追溯依據；可直接調整最終金額，調整後隨時可再次修改，直到按下確認。
- **確認機制**：後台按鈕操作，登入態下天然歸屬單一商家，不需要額外的訊息路由判斷機制。
- **並發報價**：系統天然支援商家同時處理多組待確認報價——每筆報價在後台列表中各自獨立，商家逐一點開操作即可，不存在「這則操作屬於哪一張」的歸屬判斷問題（這正是網頁後台相對於即時通訊介面的優勢，2026-07-07 拍板改用後台的主因之一）。
- **兩個 touchpoint 的差異**：Touchpoint 1 是「AI 不確定時才問人」，Touchpoint 2 是「不管 AI 多確定，都要人點頭」——分別對應「降低使用者負擔」與「業務風險控管」兩種不同的 HITL 設計動機。

---

## 8. Eval 方法論

### 8.1 Golden Test Set（backlog，WBS 7.1）

手動撰寫 30-50 則模擬客戶口語描述（涵蓋：資訊完整案例、缺 1-2 個關鍵欄位案例、edge case 如超出價目表範圍案例），每則附上人工標註的「正確結構化欄位」與「合理報價區間」，供反問輪數/門檻校準使用。

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

### 8.3 呈現方式：降級為內部工具（已拍板）

不做視覺化 Eval Dashboard——建置與維護一個 dashboard 的投入，相對於直接把心力放在產品核心功能（多租戶、後台終審、Email 寄送）上，效益偏低。改以 `eval_runs` 表 + SQL 直查、`scripts/verify-*.ts` 對真實環境的實測腳本，滿足「有做評估、可驗證」的需求（WBS 7.2）。

---

## 9. FinOps 成本治理

- **成本追蹤粒度**：每次 agent 呼叫記錄 token 用量、模型、單價、換算成本，寫入 `cost_logs`。
- **模型分層策略**：簡單抽取任務走輕量/低成本模型；此分層本身即是 FinOps 治理的具體展示。
- **免費層額度追蹤**：Gemini API 的 Flash 系列在免費層有每日請求數上限；以 SQL 直查 `cost_logs` 顯示當日已用量 vs 額度（backlog，WBS 7.4），避免無預警超出免費額度轉為計費。
- **呈現方式**：不做視覺化 FinOps Dashboard（理由同 §8.3）——每張報價成本、模型使用分布、累積花費，皆以 SQL 直查 `cost_logs` 取得。

---

## 10. 技術棧（已確認並實作）

| 層 | 選項 |
|---|---|
| 前端 | Next.js 16（wizard 多步驟 UI + 商家後台），部署於 Vercel |
| Orchestration/API | Next.js API Routes（Vercel Serverless Functions）。每個 function 只做「單一 agent 呼叫 + 寫回 Supabase」這種短任務，狀態全存在 Supabase，跨步驟由下一次呼叫接續，避免撞到免費層的執行時間上限 |
| 認證 | **Supabase Auth**（`@supabase/ssr`）。商家以 email/密碼註冊登入；`middleware`（Next 16 下改名 `proxy.ts`）保護 `/dashboard/**`、`/onboarding` |
| 客戶端最終通知 | **Resend HTTP API**（免費層 100 封/日），平台域名寄出、`reply_to` 設為商家的聯絡 email，客戶回信直達商家。取代舊版 Gmail + Nodemailer 方案——Gmail app password 綁單一帳號是單一使用者思維，且 serverless 環境對長連線 SMTP 不友善 |
| 資料庫 | Supabase（Postgres），存商家、session、抽取結果、報價項目、修改歷程、eval 紀錄、cost log；所有表啟用 RLS（deny-by-default） |
| LLM API | **Gemini API**。輕量任務（Intake Parser、Clarification）用 Flash-Lite 系列；確切模型版本代號依開發當時 Google 官方可用清單挑選 |
| 部署 | Vercel（前端 + API）+ Supabase 免費層 |

**設計原則備忘**：價目表（附錄 A）設計成 Supabase 資料表（`rate_card_base` / `rate_card_modifiers`，每個商家各自一份），而非寫死在程式碼裡——商家在後台調整報價數字，不需要重新部署。新商家 onboarding 時，系統自動從全域範本表（`rate_card_template_base` / `rate_card_template_modifiers`）複製一份起始價目表，避免空表導致計價卡死。

**已棄用**：LINE Messaging API（Bot 終審已改後台，見 §6、§7）。

---

## 11. 資料模型

租戶原則：`merchants` 為 tenant 根（1:1 對應 `auth.users`）；`sessions`、`rate_card_base`、`rate_card_modifiers`、`quotes` 直接持有 `merchant_id`；`raw_inputs` / `extracted_fields` / `clarification_turns` / `price_line_items` 經 `session_id` 間接歸屬，不冗餘加欄位。

| 資料表 | 主要欄位 | 備註 |
|---|---|---|
| `merchants` | id（= auth.users.id）, display_name, public_slug, contact_email, created_at, updated_at | tenant 根；`public_slug` 即專屬連結 `/q/{slug}` |
| `sessions` | id, merchant_id, category, contact_email, status, current_step, created_at, updated_at | 狀態機 8 態（見下） |
| `raw_inputs` | id, session_id, raw_text, created_at | 每次客戶送出描述新增一列，保留完整歷程 |
| `extracted_fields` | id, session_id, field_name, value, confidence, source_span, updated_at | 依 (session_id, field_name) upsert |
| `clarification_turns` | id, session_id, round, question, answer, triggered_field, created_at | |
| `rate_card_base` | id, merchant_id, category, subtype, unit, base_price, includes, is_active | 商家自有價目表；`is_active` 為軟刪除（真實 DELETE 被引用它的報價 FK 擋下） |
| `rate_card_modifiers` | id, merchant_id, category, modifier_name, trigger_condition, range_min, range_max | 商家自有加成規則 |
| `rate_card_template_base` / `rate_card_template_modifiers` | 同上，不含 merchant_id | 全域範本，onboarding 時複製一份給新商家 |
| `price_line_items` | id, session_id, item_name, amount, rule_id, modifier_id, agent_reasoning, confidence, created_at, updated_at | `rule_id`/`modifier_id` 恰一個非 null；商家手動調整的差額列兩者皆 null |
| `quotes` | id, session_id, merchant_id, quote_code, final_amount, status, is_conservative, pdf_url, created_at, sent_at | `quote_code` 於商家範圍內唯一 |
| `rate_limits` | bucket_key, window_start, count | 公開端點固定視窗限流 |
| `eval_runs` | id, run_id, dataset_version, metric_name, value, model_version | backlog（§8） |
| `cost_logs` | id, session_id, agent_name, model, input_tokens, output_tokens, cost_usd, latency_ms, created_at | 每次 LLM 呼叫寫入 |

**Session 狀態機（8 態）**：`created → parsing → awaiting_clarification/pricing → awaiting_review → confirmed → sent`，逾時可轉 `abandoned`。取代舊版 9 態（`revising` 已淘汰，`awaiting_freelancer` 更名為 `awaiting_review`，因為終審通路已從 LINE 改為網頁後台）。

**已淘汰**：`line_binding`、`revision_turns`（含 `revision_channel` enum）——LINE 終審鏈棄用後不再需要。

---

## 12. 非功能需求

- **延遲預算**：Step 3 解析（含至多 1 輪反問前的首次抽取）建議 < 5 秒，避免使用者等待焦慮。
- **可觀測性**：每個 agent 呼叫皆有結構化 log（輸入摘要、輸出、耗時、成本），供 eval 與 debug 使用。
- **租戶隔離**（多租戶新增）：任何跨租戶的存取嘗試一律回 404（不回 403，避免洩漏資源存在性）；應用層 `requireMerchant` 為主要保證，RLS owner policy 為防禦縱深第二道防線；涉及跨表原子寫入（如報價確認）以 Postgres RPC 搭配 CAS 保證一致性，不依賴應用層順序寫入。
- **隱私**：測試資料不含真實客戶個資，測試案例皆為虛構或去識別化。

---

## 13. 里程碑

多租戶重構依 `documents/BizMate_多租戶重構計畫_v1.0.md` 分階段交付，每個 milestone 結束系統可跑、測試綠，`--no-ff` 併回 main。

| 階段 | 內容 | 狀態 |
|---|---|---|
| M0 | Next.js + Supabase + client 封裝 | ✅ 完成 |
| M1（單租戶） | Wizard + Parser + deterministic 報價 happy path | ✅ 完成 |
| P1 前段 | 反問迴圈 + 保守估價 | ✅ 完成 |
| **MT-M1 多租戶地基** | DB 重寫多租戶 schema、merchantId 貫穿、`/q/{slug}` 入口 | ✅ 完成 |
| **MT-M2 註冊登入可用** | Supabase Auth、onboarding、requireMerchant、RLS policies、dashboard 骨架 | ✅ 完成 |
| **MT-M3 服務自管** | 服務項目 CRUD API + UI，跨租戶隔離驗證 | ✅ 完成 |
| **MT-M4 後台終審** | 報價列表/詳情、調金額、確認（原子 RPC 保證一致性） | ✅ 完成 |
| MT-M5 報價寄達 | Resend Email 寄送，quote 進終態 `sent` | 🔄 進行中 |
| MT-M6 產品收尾 | per-slug rate limit、env 清理、landing 導 signup、settings 頁 | ⏳ 待處理 |
| 進階功能 | Pricing Reasoning Agent、E2E 測試、安全審查、正式部署 | ⏳ 待處理（backlog） |

---

## 14. 關鍵決策記錄

### 14.1 已確認決策

| # | 項目 | 決策 |
|---|---|---|
| 1 | 命名 | **BizMate** |
| 2 | LLM Provider | **Gemini API**（輕量任務用 Flash-Lite，見第 10 章） |
| 3 | 產品型態 | **多租戶 SaaS**（2026-07-07 拍板，取代原「單一接案者 demo」假設） |
| 4 | 價目表細節 | 結構定案於**附錄 A**，設計成 Supabase 資料表（每商家一份，非寫死程式碼），onboarding 自動複製全域範本 |
| 5 | 後端型態 | **Next.js API Routes（Vercel Serverless Functions）**，以免費層可部署為核心考量 |
| 6 | 認證 | **Supabase Auth**（`@supabase/ssr`），取代原「先前假設不需要帳號系統」的判斷 |
| 7 | 終審通路 | **網頁後台**（`/dashboard/quotes`），取代原 LINE Bot 終審鏈（2026-07-07 拍板棄用） |
| 8 | 商家終審輪數 | 不設嚴格上限，僅追蹤成本（見第 9 章） |
| 9 | 客戶端 Email 服務 | **Resend HTTP API**，取代原 Gmail + Nodemailer 方案（見第 10 章） |
| 10 | 租戶隔離保證 | 應用層 `requireMerchant` 為主，RLS owner policy 為第二道防線；跨表原子寫入一律走 Postgres RPC + CAS |

### 14.2 剩餘待確認事項

1. **Clarification 輪數上限與 confidence 門檻的實際數值**：目前沿用「最多 3 輪」的初始假設值，尚待 golden set 資料（§8.1，backlog）校準。
2. **Email 寄送網域**：先用 Resend 共用網域跑，或及早申請自有網域做 SPF/DKIM——待 MT-M6 部署前決定。

---

## 附錄 A｜Rate Card 結構骨架（案件類型 × 定價維度）

本附錄定義 Quote Formatter 依賴的定價結構。**結構已於全域範本表落地並填入實際起始數字**（`scripts/rate-card-data.ts`），商家 onboarding 時自動複製一份到自己名下，之後可在 `/dashboard/services` 自行調整（含新增/停用，見 MT-M3）。以下維度骨架供理解系統設計依據，非最終定價（實際定價由各商家自主決定）。

### A.1 跨案件類型的共用維度

不管平面設計 / 插畫 / 網頁設計，這幾項都會出現，且都由第 7.1 章的反問機制把關：

| 維度 | 說明 | 決策層 |
|---|---|---|
| 用途/授權範圍 | 個人使用 / 商業使用 / 獨家買斷 / 有限期限授權 | Deterministic 查表（依授權等級對應加成倍率） |
| 交期 | 標準交期 vs 急件 | Deterministic 判斷，加成幅度落在該商家自訂的區間內 |
| 修改次數 | 報價內含基本修改次數，超出後每次加價 | Deterministic 查表 |

### A.2 平面設計 (Graphic Design)

**必要欄位**（Parser Agent 必須抽取，缺漏觸發反問）：子類型（LOGO設計 / 海報文宣 / 品牌識別CI-VI / 社群圖像 / 名片文具）、數量、是否含比稿輪數。

| 子類型 | 計價單位 |
|---|---|
| LOGO 設計 | 每款 |
| 海報/文宣 | 每張 |
| 品牌識別(CI/VI) | 每套（通常含LOGO+應用規範） |
| 社群圖像 | 每張/每組 |
| 名片/文具 | 每組 |

**加成係數**：印刷檔輸出（客戶要求印刷用檔案，非僅螢幕用）、品牌規範完整度（僅 LOGO vs 完整 VI 系統文件）。

### A.3 插畫 (Illustration)

**必要欄位**：子類型（角色設計 / 單張插畫 / 系列插畫封面內頁 / 貼圖表情包）、張數或角色數、上色複雜度（線稿 / 簡易上色 / 精緻上色）、尺寸解析度需求。

| 子類型 | 計價單位 |
|---|---|
| 角色設計 | 每角色 |
| 單張插畫 | 每張 |
| 系列插畫 | 每張（通常套組折扣） |
| 貼圖/表情包 | 每組（常見16-24張/組） |

**加成係數**：上色複雜度加成（精緻上色 vs 簡易上色/線稿）、高解析度/印刷輸出。

### A.4 網頁設計 (Web Design)

**必要欄位**：子類型（Landing Page / 多頁式網站 / 電商網站 / UI-UX設計稿）、頁數、功能模組（會員系統/金流/多語系等，可複選）、是否含RWD、是否含後台CMS。

| 子類型 | 計價單位 |
|---|---|
| Landing Page | 每頁 |
| 多頁式網站 | 每頁（通常套組折扣） |
| 電商網站 | 整案（依功能模組疊加） |
| UI/UX 設計稿 | 每頁面 |

**加成係數**：功能模組複雜度（每加一個模組）；是否含前端切版實作——已超出「設計」範疇，標記為「超出價目表，需人工評估」，不自動加成。

### A.5 這份骨架如何餵給系統

- 「基礎定價維度」三張表 → 對應 `rate_card_base` / `rate_card_template_base` 資料表，deterministic 查表用
- 「加成係數」三張表 + A.1 共用維度 → 對應 `rate_card_modifiers` / `rate_card_template_modifiers` 資料表，即第 6.3 章 bounded autonomy 表中「區間由商家自行設定」的實際來源
- 「必要欄位」清單 → 直接對應 Intake Parser Agent 依案件類型切換的抽取 schema，以及 Step 3 反問機制判斷「缺哪個欄位」的依據

---

*此為 v0.3，已依 2026-07-07 多租戶重構拍板內容全面更新；LINE 終審鏈章節（原 §5、§6、§7 相關段落）已改寫為網頁後台終審；Eval/FinOps 章節已依降級決策改寫（不做 dashboard）。權威依據：`documents/BizMate_多租戶重構計畫_v1.0.md`。*
