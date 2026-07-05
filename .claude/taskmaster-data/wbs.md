# WBS - BizMate

**建立日期:** 2026-07-04
**最後更新:** 2026-07-05（M1：3.1~3.5 ✅；POST /describe 端到端串接完成並併入 main(8940120)，170 測試綠、verify:describe 實測通過。剩 3.6·3.7）
**開發模式:** MVP 分階段（P0 → P1 → P2 → P3）
**專案描述:** 自動化報價系統。客戶透過 Web Wizard 以口語文字描述需求，系統以多 Agent 管線解析並產出可追溯報價，經接案者透過 LINE Bot 人工終審後，以 Email 寄送最終報價單。
**技術棧:** Next.js + Vercel Serverless / Supabase(Postgres) / Gemini API / LINE Messaging API / Gmail SMTP
**文件依據:** PRD v0.2 / SRS v0.1 / SAD v0.1 / SDS v0.2

---

## 任務清單

| # | 任務 | 狀態 | 優先級 | 依賴 | 預估 | 對應需求 / 備註 |
|---|------|------|--------|------|------|------|
| **1. 專案啟動** | | | | | | |
| 1.1 | 專案初始化（git + 目錄結構） | ✅ 完成 | 高 | - | 0.5h | 自動完成 |
| 1.2 | 需求分析（PRD/SRS/SAD/SDS 消化） | ✅ 完成 | 高 | - | 1h | 自動完成 |
| **2. 基礎設施（P0 前置）** | | | | | | |
| 2.1 | Next.js 專案骨架 + TypeScript + Tailwind + 目錄結構 | ✅ 完成 | 高 | 1.2 | 2h | Next16/React19/TW4；build·tsc·lint 全綠 |
| 2.2 | Supabase 專案建立 + schema migration（12 張表 + enum + index） | ✅ 完成 | 高 | 2.1 | 3h | 12/12 表驗收通過；RLS + service_role 授權 |
| 2.3 | 環境變數管理 + 啟動時驗證（schema-based） | ✅ 完成 | 高 | 2.1 | 1h | zod fail-fast；空字串→未設定；requireEnv |
| 2.4 | Supabase client 封裝（Repository Pattern） | ✅ 完成 | 高 | 2.2 | 2h | 泛型 BaseRepository + 手寫 DB 型別；E2E CRUD 驗收 |
| 2.5 | Gemini client 封裝（structured output + usageMetadata + 重試） | ✅ 完成 | 高 | 2.3 | 3h | @google/genai 2.5系列；zod schema 三用；實測呼叫通過 |
| 2.6 | Cost Logger（cross-cutting，每次 LLM 呼叫寫 cost_logs） | ✅ 完成 | 高 | 2.5 | 1.5h | MODEL_PRICING + generateStructuredAndLog；實測寫入正確 |
| 2.7 | Rate card 種子資料（demo 示意數字，避免報價空白） | ✅ 完成 | 中 | 2.2 | 1h | 13 base + 8 modifiers（TWD 示意）；冪等 seed 腳本 |
| **3. P0：Happy Path（Wizard + Parser + deterministic 報價）** | | | | | | |
| 3.1 | Orchestrator 狀態機（9 狀態 + 轉移表） | ✅ 完成 | 高 | 2.4 | 3h | SDS §4；轉移表查表法；純函式 + Result；107 測試 100% 覆蓋 |
| 3.2 | Wizard API：POST /sessions、GET /status | ✅ 完成 | 高 | 3.1 | 2.5h | SDS §5.1；FR-CW-1,4；薄 route+service 分層+信封+zod；20 測試。/describe 因需 Parser 移 3.3 |
| 3.3 | Intake Parser Agent（結構化抽取 + confidence + source_span） | ✅ 完成 | 高 | 2.5,3.1 | 3h | SDS §6.1；FR-PA-1~2；依 category 切換欄位；missing 程式端 deterministic 算；真實 Gemini 實測通過。POST /describe 已於 8940120 端到端串接（Parser+報價鏈+持久化，齊全出報價／缺欄位轉 awaiting_clarification／out_of_scope 轉人工） |
| 3.4 | Quote Formatter（deterministic 模板 + quote_code 產生器） | ✅ 完成 | 高 | 3.1 | 2h | SDS §6.4；FR-PR-1；quote_code {類型首字}-{年月}{流水}；真實資料實測 |
| 3.5 | 基礎費率查表（deterministic，rule_id 可回溯） | ✅ 完成 | 高 | 2.4 | 2h | FR-PR-1、FR-PR-4；基礎費+固定倍率modifier；區間留4.3；out_of_scope；23 測試 |
| 3.6 | Web Wizard 前端（Step 1-4 UI + 狀態輪詢 + a11y/ARIA） | ⏳ 待處理 | 高 | 3.2 | 5h | FR-CW-1~4；coding-style |
| 3.7 | 輸入驗證 + rate limiting（公開端點防濫用） | ⏳ 待處理 | 高 | 3.2 | 1.5h | NFR-7、SDS §13.3 |
| **4. P1：多 Agent + Bounded Autonomy + LINE 終審 + Email** | | | | | | |
| 4.1 | Clarification Agent（單題反問 + 優先序 + 輪數上限） | ⏳ 待處理 | 高 | 3.3 | 2.5h | SDS §6.2；FR-CL-1~2 |
| 4.2 | 反問 API：POST /answer + 保守估價 fallback | ⏳ 待處理 | 高 | 4.1 | 2h | FR-CL-3；SDS §5.1 |
| 4.3 | Pricing Reasoning Agent（區間內加成判斷） | ⏳ 待處理 | 高 | 3.5 | 3h | SDS §6.3；FR-PR-2 |
| 4.4 | 程式層區間驗證（超界拒寫 + out_of_scope 轉人工） | ⏳ 待處理 | 高 | 4.3 | 2h | FR-PR-2 AC、FR-PR-3；NFR-8 |
| 4.5 | 預算護欄（呼叫貴模型前檢查累積成本，記錄不阻擋） | ⏳ 待處理 | 中 | 2.6,4.3 | 1.5h | FR-FO-4；SDS §11 |
| 4.6 | LINE Webhook + 簽章驗證（HMAC-SHA256）+ 事件去重 | ⏳ 待處理 | 高 | 3.1 | 2.5h | SDS §5.2、§13.1；NFR-5、NFR-10 |
| 4.7 | Session Router（deterministic 並發歸屬 + 聚焦機制） | ⏳ 待處理 | 高 | 4.6 | 2.5h | SDS §7.3；FR-LN-2、FR-LN-4；ADR-5 |
| 4.8 | LINE Push Dispatcher（Flex Message + Quick Reply） | ⏳ 待處理 | 高 | 3.4,4.6 | 2h | SDS §7.1；FR-LN-1 |
| 4.9 | LINE Revision Agent（口語修改指令 → 結構化動作） | ⏳ 待處理 | 高 | 4.7 | 3h | SDS §6.5；FR-LN-3、FR-LN-6 |
| 4.10 | 確認與寄出流程（confirm_intent → sent，防重複寄送） | ⏳ 待處理 | 高 | 4.9 | 1.5h | FR-LN-5 |
| 4.11 | Email Dispatcher（Nodemailer + Gmail SMTP + 失敗記錄） | ⏳ 待處理 | 高 | 4.10 | 2h | SDS §8；FR-EM-1 |
| **5. P2：Eval 框架** | | | | | | |
| 5.1 | Golden Set（30-50 則標註案例，版本化存 repo） | ⏳ 待處理 | 中 | 4.4 | 3h | SDS §10；FR-EV-1 |
| 5.2 | Eval Runner（跑真實 pipeline + 指標計算，寫 eval_runs） | ⏳ 待處理 | 中 | 5.1 | 4h | FR-EV-2；PRD §8.2 |
| 5.3 | Eval Dashboard（指標彙總 + 跨次比較 + shared secret 保護） | ⏳ 待處理 | 中 | 5.2 | 3h | FR-EV-3；NFR-6、SDS §13.2 |
| **6. P3：FinOps 治理** | | | | | | |
| 6.1 | 模型分層落地（Flash-Lite / Flash 旗艦款路由） | ⏳ 待處理 | 中 | 4.3 | 1h | FR-FO-2；ADR-4 |
| 6.2 | 免費層額度追蹤（每日用量 vs 上限） | ⏳ 待處理 | 中 | 2.6 | 1.5h | FR-FO-3；SDS §11 |
| 6.3 | FinOps Dashboard（每張成本 / 模型分布 / 護欄次數） | ⏳ 待處理 | 中 | 6.1,6.2 | 3h | FR-FO-1~4；PRD §9 |
| **7. 貫穿性任務（每階段並行）** | | | | | | |
| 7.1 | 單元 + 整合測試（TDD，80%+ 覆蓋率） | 🔄 進行中 | 高 | 各實作 | 貫穿 | Vitest 設施就緒（3.1 引入）；覆蓋率白名單策略見測試指南；M0 模組待補測 |
| 7.2 | E2E 測試（Playwright，關鍵使用者流程） | ⏳ 待處理 | 中 | 3.6,4.11 | 4h | testing.md E2E |
| 7.3 | 安全審查（prompt injection 三層防禦驗證 + OWASP） | ⏳ 待處理 | 高 | 4.4 | 2h | NFR-8；SDS §13；security.md |
| 7.4 | 部署（Vercel + Supabase 免費層，實測執行上限） | ⏳ 待處理 | 中 | 4.11 | 2h | NFR-3；SAD R-1 |

### 狀態說明
- ✅ 完成　🔄 進行中　⏳ 待處理　🚫 阻塞　⏭️ 跳過

---

## 里程碑

| 里程碑 | 目標 | 包含任務 | 狀態 |
|--------|------|----------|------|
| M0: 基礎設施就緒 | Next.js + Supabase + client 封裝可運行 | 2.1-2.7 | ✅ 完成 |
| M1: P0 Happy Path | 完整走完「選項目→描述→deterministic 報價」 | 3.1-3.7 | ⏳ 待處理 |
| M2: P1 核心價值 | 多 Agent + bounded autonomy + LINE 終審 + Email 全通 | 4.1-4.11 | ⏳ 待處理 |
| M3: P2 Eval 可視化 | Golden set + Eval dashboard 可展示 | 5.1-5.3 | ⏳ 待處理 |
| M4: P3 FinOps 可視化 | 成本追蹤 + FinOps dashboard 可展示 | 6.1-6.3 | ⏳ 待處理 |
| M5: Demo Ready | E2E 通過 + 部署上線 + 5 分鐘 demo 腳本 | 7.1-7.4 | ⏳ 待處理 |

> 時程對齊：PRD §13 建議 BizMate 於 CareLoop（8/15 死線）之後啟動，避免資源分散。

---

## 風險與阻塞

| 風險 | 影響 | 緩解策略 |
|------|------|----------|
| Vercel Hobby 單次執行上限不確定 | 長 LLM 呼叫被 504 截斷 | NFR-3：單 function 單呼叫；2.1 階段實測上限（SAD R-1） |
| Gemini 免費層額度政策變更 | 成本假設失效 | MODEL_PRICING 設定外置；FR-FO-3 額度追蹤（SAD R-2） |
| Rate card 數字長期未填（TBD） | 系統可跑但報價為空 | 任務 2.7 填入 demo 示意數字（SAD R-5） |
| Clarification 門檻/輪數需 eval 校準 | 初期反問精準率不穩 | 先用假設值（2-3 輪），P2 後依 eval 調整（PRD §14.2 #1） |
| LINE webhook 冷啟動慢 → 平台重送 | 重複套用同一動作 | NFR-10：webhookEventId 去重（任務 4.6，SAD R-3） |
| Gmail App Password 政策收緊 | 寄信失效 | 預留 Gmail API OAuth2 備案（SDS §8，SAD R-4） |

---

## 待確認事項（開發中校準，不阻塞啟動）

1. Clarification 輪數上限與 confidence 門檻的實際數值 — 需 golden set 校準（PRD §14.2 #1）
2. Rate card 各 TBD 數字 — 由接案者陸續填入 Supabase（PRD 附錄 A）
