# WBS - BizMate

**建立日期:** 2026-07-04
**最後更新:** 2026-07-19（7.2 Eval Runner 已完成：`pnpm eval` 對真實 pipeline 跑 golden set 並計算 **PRD §8.2 全部 11 項指標**，寫入 eval_runs（FR-EV-2 AC 滿足：dataset_version + model_version 均標記，SQL 直查已驗證跨次比較可行）。**關鍵設計**：(1) 報價偏差不用人工標註報價區間——計價是 deterministic 查表，人工標等於抄 rate card 算一遍（用實作驗證實作）；改以「標註欄位跑計價」為基準，量到的是「抽取錯誤值多少錢」 (2) 不需跑完整 describe→反問→報價流程：Parser 之後全是 deterministic，一則一次 LLM 呼叫即可算完全部指標 (3) verify:golden-set 已刪除，合併進 `pnpm eval --dry-run`（邏輯重複）。**過程中修正一個自己的指標定義錯誤**：端到端成功率原本把「你好」這類零資訊案例（標註即 outOfScope、轉人工是正確行為）算成失敗，系統性低估表現；分母改為「標註認為應可計價」的案例後由 86.1% → 100%。首次正式基準線：欄位準確率 97.5%、F1 97.0%、反問 P 98.1%/R 100%、幻覺 0%、報價偏差平均 22.6%/最大 700%、端到端 100%、Parser 延遲 1295ms(P95 1717ms)、每案 $0.000442。475 測試綠。同日稍早：6.8 Parser 欄位值域約束已完成——**指標驅動開發的首次完整閉環**：7.1 的 golden set 量到 81.4% 基準線並定位缺陷，6.8 修復，同一份資料集重測驗證成效。欄位抽取準確率 81.4% → **97.1%**、全對案例 30.6% → **83.3%**、缺漏判定 Precision 91.4% → 96.4%、Recall 100% 維持、**幻覺 0 維持**（關鍵：證明 enum 未逼出「自信的錯配」，那是此解法最大風險）。作法：subtype 值域由 orchestrator 查該商家 rate card 後傳入 Parser（intake 不依賴 pricing domain），license_scope/coloring_complexity/includes_* 用靜態值域，全部編進 Gemini 的 responseJsonSchema enum；nullable enum + system instruction 明令「不得勉強歸類」三層防錯配。435 測試綠。同日稍早：7.1 Golden Set 已完成：36 則標註案例（每類 12：4 完整/5 部分缺漏/3 邊界含 prompt injection）+ 14 項完整性測試 + verify:golden-set 基準線腳本。**首跑即抓到 HIGH 缺陷（→ 新增 6.8）**：Parser 未把 subtype 約束到 rate card 值域，實際抽出「LOGO」「landing page」「公司形象官網」等原文詞，而 findBase 用精確相等查表 → 查無 → outOfScope → final_amount 為 null，自動報價退化為人工。修復前基準線（gemini-3.1-flash-lite）：欄位抽取準確率 81.4%、全對案例 30.6%、缺漏判定 Precision 91.4% / Recall 100%、幻覺 0。另發現 Gemini 免費層 15 RPM 限制，腳本內建 4.5s 節流，7.2/8.5 需沿用。上一版 2026-07-16：開始 8.4 部署（進行中）。上一版 2026-07-15：CI/CD 缺口檢視：Vercel Git 整合只部署程式碼、不套用 Supabase migrations，新增 8.6 migration 部署管線（migration 先行於程式碼部署）＋風險表新增對應風險項。同日稍早：求職作品集缺口盤點（可靠性/可觀測性/安全性/成本控制四維度）：新增 8.5（verify:*+Eval Runner 接 CI 雙閘門）、6.4-6.7（調價 diff 品質指標化/模型路由/回退模型鏈/trace_id 全鏈追蹤）；7.1/7.2/8.4 升為高優先級、6.3/7.4 升為中；新增 Portfolio-Ready 里程碑；7.1 依賴 6.2→5.9（經檢視屬排程順序而非真依賴）；補記：8.2 E2E、8.3 安全審查已於 2026-07-13 完成。上一版 2026-07-13：開始 8.3 安全審查（進行中）。上一版 2026-07-11：🎉 MT-M6 里程碑達成：5.9 收尾強化已完成——POST /sessions 補 slug rate limit 桶（IP 桶原本沒防同一商家被大量不同來源灌爆）；刪除 LINE_*/GMAIL_*/ADMIN_SECRET 五個零引用 env 欄位；landing 加「開始使用/登入」CTA；新增 GET/PATCH /api/dashboard/settings + /dashboard/settings 頁（slug 撞號沿用新抽出的 isUniqueViolation 共用工具→409，這是第三次出現同一段邏輯後的 DRY 重構）；397 測試綠 + 全部 16 支 verify:* 腳本對真實 DB/Gemini/Resend 跑過皆通過；**已知落差**：settings 表單的互動流程尚未經過真人或瀏覽器自動化點擊驗證（環境無瀏覽器工具，curl 模擬 SSR cookie session 未能還原成功），僅由 mock 單元測試+真實 repository 層驗證共同保證，建議合併前補一次手動瀏覽器驗證。上一版：🎉 MT-M5 里程碑達成：5.8 Email 寄送已完成——confirm_quote RPC 改名重用為通用的 advance_quote_status（+p_set_sent_at），供確認與寄送兩個轉移共用（DRY，兩者本質是同一種雙表原子性問題）；sendQuoteEmail 刻意固定順序：先呼叫 Resend、成功才推進狀態，避免「狀態已 sent 但信沒寄出」；對真實 Resend API 實際寄出一封信並人工核對主旨/寄件者/reply-to/內文全數正確。372 測試綠。上一版：🎉 MT-M4 里程碑達成：5.7 MT-M4b 已完成——migration 0005 兩個原子 RPC 保證 quotes.status 與 sessions.status 同步推進（Supabase JS 無多語句 transaction）；調金額以「手動調整」明細列補差額，維持 sum(line_items)==final_amount 不變式；code review 後補上 adjust 的 session 閘門（關掉「quote 已待審、明細未落地」的窗口）與 verify script 的三組直接 RPC 斷言（原本全走 service，RPC 的 CAS 與 WHERE merchant_id 從未被真的觸發過）。353 測試綠。上一版：MT-M4a 已完成：quotes 列表/詳情 API（GET /api/dashboard/quotes?status=、GET /[id]）+ /dashboard/quotes 列表頁（狀態篩選 tab）+ /dashboard/quotes/[id] 詳情頁（費用明細/抽取欄位/澄清歷程/原始描述）；quoteReviewService 為租戶隔離唯一入口——四張子表無 merchant_id，故子表查詢只接受經 quote 歸屬檢查後帶出的 session_id；code review 後補上 session.merchant_id 複查（quotes 的兩個 FK 獨立，DB 無 composite FK 保證）。320 測試綠，verify-quotes.ts 對真實 DB 雙商家證明跨租戶取詳情回 null、列表只回自己的列。上一版：MT-M3 已完成：services CRUD API（GET/POST /api/dashboard/services、PATCH/DELETE /[id]）+ /dashboard/services 頁面（inline 編輯 + 新增 + 軟刪除）+ rate_card_modifiers 唯讀顯示；rate_card_base 加 is_active 軟刪除欄位（migration 0004），basePricing 計價自動排除停售項目；292 測試綠，verify-services.ts 對真實 DB 證明「真實 DELETE 被 FK 擋下、軟刪除不受限」；手動 curl 模擬真實登入 session 對 dev server 走過完整回圈（新增/撞號 409/編輯/軟刪除/跨租戶 404/未登入 401）全數通過。上一版：🎉 MT-M2 里程碑完整達成：MT-M2c 已完成併入 main：requireMerchant 守門工具、RLS owner policies（migration 0003，防禦縱深第二道防線）、/dashboard 骨架（待審數+分享連結複製）。261 測試綠，verify-auth.ts 自動化證明 RLS 隔離有效（商家 A 直查只回自己的列）、db:verify 14/14 張表存取正常。上一版：MT-M2b 已完成併入 main：POST /api/dashboard/onboarding（冪等，slug 自動生成+碰撞重試）、/onboarding 頁面、proxy.ts 依 merchant 存在性導流。再上一版：MT-M2a 已完成併入 main：@supabase/ssr + middleware（改名 proxy.ts 對齊 Next 16）保護 /dashboard、/onboarding；/login /signup Server Action 頁面。更早：2026-07-07 專案方向轉型：單一接案者 demo → 多使用者 SaaS，MT-M1 已完成併入 main（779741d）：DB 重寫多租戶 schema、merchantId 全鏈貫穿、wizard 搬 /q/{slug}。LINE 終審鏈（原 4.6–4.11）作廢，改網頁後台終審）
**開發模式:** MVP 分階段（多租戶重構 MT-M2 → MT-M6，之後進階功能）
**專案描述:** 多租戶自動化報價 SaaS。使用者（接案者/商家）註冊登入、管理自己的服務項目與價格，取得專屬分享連結 /q/{slug} 傳給客戶；客戶以口語文字描述需求，系統以多 Agent 管線解析並產出可追溯報價，商家於網頁後台終審後以 Email 寄送最終報價單。
**技術棧:** Next.js 16 + Vercel Serverless / Supabase(Postgres + Auth) / Gemini API / Resend(Email)
**文件依據:** 多租戶重構計畫 `documents/BizMate_多租戶重構計畫_v1.0.md`（最新權威）；PRD v0.3（2026-07-11 已依多租戶方向全面改寫，取代 v0.2）／SRS v0.1 / SAD v0.1 / SDS v0.2（單一使用者假設與 LINE 章節已作廢，其餘仍有效）

---

## 任務清單

| # | 任務 | 狀態 | 優先級 | 依賴 | 預估 | 對應需求 / 備註 |
|---|------|------|--------|------|------|------|
| **1. 專案啟動** | | | | | | |
| 1.1 | 專案初始化（git + 目錄結構） | ✅ 完成 | 高 | - | 0.5h | 自動完成 |
| 1.2 | 需求分析（PRD/SRS/SAD/SDS 消化） | ✅ 完成 | 高 | - | 1h | 自動完成 |
| **2. 基礎設施（M0）** | | | | | | |
| 2.1 | Next.js 專案骨架 + TypeScript + Tailwind + 目錄結構 | ✅ 完成 | 高 | 1.2 | 2h | Next16/React19/TW4；build·tsc·lint 全綠 |
| 2.2 | Supabase 專案建立 + schema migration | ✅ 完成 | 高 | 2.1 | 3h | 原 12 表；已被 5.1 多租戶 schema 重寫取代 |
| 2.3 | 環境變數管理 + 啟動時驗證（schema-based） | ✅ 完成 | 高 | 2.1 | 1h | zod fail-fast；空字串→未設定；requireEnv |
| 2.4 | Supabase client 封裝（Repository Pattern） | ✅ 完成 | 高 | 2.2 | 2h | 泛型 BaseRepository + 手寫 DB 型別；E2E CRUD 驗收 |
| 2.5 | Gemini client 封裝（structured output + usageMetadata + 重試） | ✅ 完成 | 高 | 2.3 | 3h | @google/genai 2.5系列；zod schema 三用；實測呼叫通過 |
| 2.6 | Cost Logger（cross-cutting，每次 LLM 呼叫寫 cost_logs） | ✅ 完成 | 高 | 2.5 | 1.5h | MODEL_PRICING + generateStructuredAndLog；實測寫入正確 |
| 2.7 | Rate card 種子資料 | ✅ 完成 | 中 | 2.2 | 1h | 已被 5.1 改造：灌全域範本表 + dev 商家複製 |
| **3. P0：Happy Path（Wizard + Parser + deterministic 報價）** | | | | | | |
| 3.1 | Orchestrator 狀態機（轉移表查表法） | ✅ 完成 | 高 | 2.4 | 3h | 純函式 + Result；5.1 已改 8 態（awaiting_review + quote_confirmed） |
| 3.2 | Wizard API：POST /sessions、GET /status | ✅ 完成 | 高 | 3.1 | 2.5h | 薄 route+service 分層+信封+zod；5.1 已改必帶 slug |
| 3.3 | Intake Parser Agent（結構化抽取 + confidence + source_span） | ✅ 完成 | 高 | 2.5,3.1 | 3h | FR-PA-1~2；依 category 切換欄位；POST /describe 端到端串接 |
| 3.4 | Quote Formatter（deterministic 模板 + quote_code 產生器） | ✅ 完成 | 高 | 3.1 | 2h | 5.1 已改 per-merchant 流水號 + 撞號重試 |
| 3.5 | 基礎費率查表（deterministic，rule_id 可回溯） | ✅ 完成 | 高 | 2.4 | 2h | FR-PR-1、FR-PR-4；5.1 已改 per-merchant 查表 |
| 3.6 | Web Wizard 前端（Step 1-4 UI + 狀態輪詢 + a11y/ARIA） | ✅ 完成 | 高 | 3.2 | 5h | FR-CW-1~4；5.1 已搬 /q/[slug]，頁首顯示商家名 |
| 3.7 | 輸入驗證 + rate limiting（公開端點防濫用） | ✅ 完成 | 高 | 3.2 | 1.5h | NFR-7；Supabase durable 表+原子RPC 固定視窗；per-slug 分桶留 5.9 |
| **4. P1 前段（多租戶拍板前完成）+ 作廢的 LINE 鏈** | | | | | | |
| 4.1 | Clarification Agent（單題反問 + 優先序 + 輪數上限） | ✅ 完成 | 高 | 3.3 | 2.5h | FR-CL-1~2；輪數上限=3；verify:clarification 真實 Gemini 通過 |
| 4.2 | 反問 API：POST /answer + 保守估價 fallback | ✅ 完成 | 高 | 4.1 | 2h | FR-CL-3；resolveAfterParse 共用分支；quotes.is_conservative |
| 4.3 | ~~LINE Webhook + 簽章驗證 + 事件去重~~ | ⏭️ 作廢 | - | - | - | 2026-07-07 拍板：終審改網頁後台（→ 5.6/5.7），LINE 整鏈不做 |
| 4.4 | ~~Session Router（並發歸屬 + 聚焦機制）~~ | ⏭️ 作廢 | - | - | - | 同上；多租戶下 session 天然歸屬商家，無並發歸屬問題 |
| 4.5 | ~~LINE Push Dispatcher（Flex Message）~~ | ⏭️ 作廢 | - | - | - | 同上 |
| 4.6 | ~~LINE Revision Agent（口語修改指令）~~ | ⏭️ 作廢 | - | - | - | 同上；後台直接 PATCH final_amount，不需修訂 Agent |
| 4.7 | ~~確認與寄出流程（LINE confirm_intent）~~ | ⏭️ 作廢 | - | - | - | 改為後台 confirm API（→ 5.7） |
| 4.8 | ~~Email Dispatcher（Nodemailer + Gmail SMTP）~~ | ⏭️ 作廢 | - | - | - | 改用 Resend HTTP API（→ 5.8）；Gmail 綁單一帳號=單使用者思維 |
| **5. 多租戶 SaaS 重構（MT-M1 ~ MT-M6，計畫見 documents/BizMate_多租戶重構計畫_v1.0.md）** | | | | | | |
| 5.1 | MT-M1：DB 重寫多租戶 schema + merchantId 全鏈貫穿 | ✅ 完成 | 高 | 3.x | 3d | merge 779741d：merchants + 範本表、狀態機 8 態、/q/[slug]、seed dev 商家；205 測試綠、db:verify 14/14、verify:describe/answer/pricing 實測通過 |
| 5.2 | MT-M2a：認證基建（@supabase/ssr + middleware + 註冊/登入頁） | ✅ 完成 | 高 | 5.1 | 4h | 計畫 §2；serverClient + middlewareClient、middleware（Next 16 改名 proxy.ts）保護 /dashboard/**、/onboarding、/login /signup 頁（Server Action）；env 加 NEXT_PUBLIC_SUPABASE_URL/ANON_KEY；browserClient 依 YAGNI 未建（用到再補）；231 測試綠，curl 模擬瀏覽器對真實 Supabase 驗證通過 |
| 5.3 | MT-M2b：onboarding（slug 生成 + 建 merchant + 複製範本） | ✅ 完成 | 高 | 5.2 | 3h | POST /api/dashboard/onboarding（冪等，真實驗證：二次呼叫回 200 且不覆蓋 display_name）；onboardMerchant 獨立成新檔（非塞進 onboardingService.ts，避免同模組 vi.mock 攔截不到）；slug 生成用 email 前綴清洗+隨機 fallback+碰撞重試（非 spec 原訂的音譯）；proxy.ts 依 merchant 存在性導流；257 測試綠 |
| 5.4 | MT-M2c：requireMerchant 守門 + RLS owner policies + dashboard 骨架 | ✅ 完成 | 高 | 5.3 | 4h | lib/auth/requireMerchant（無 cookie 401/無 merchant 403，fail-closed）；migration 0003 owner policies + GRANT SELECT（0001 只 GRANT service_role，authenticated 原本零權限，兩者缺一查無資料）；/dashboard：requireMerchant + 待審數 + CopyLinkButton；verify-auth.ts 自動化實測通過（商家 A JWT 直查只回自己的列）；261 測試綠 |
| 5.5 | MT-M3：服務項目管理（services CRUD API + UI） | ✅ 完成 | 高 | 5.4 | 1.5d | GET/POST /api/dashboard/services、PATCH/DELETE /[id]；inline 編輯 base_price/includes/unit；modifiers 唯讀；is_active 軟刪除（migration 0004）；跨租戶隔離（B 取 A 資源→404）；verify-services.ts + 手動 curl 全回圈實測通過 |
| 5.6 | MT-M4a：報價列表 + 詳情（quotes API + UI） | ✅ 完成 | 高 | 5.4 | 1d | quoteReviewService（歸屬檢查+聚合的唯一入口）/ quoteReviewRepository；GET /api/dashboard/quotes?status=、GET /[id]；列表頁狀態篩選 tab（URL query 驅動 SSR）、詳情頁五區塊；保守估算 badge；詳情不 join 服務現價（報價是歷史快照）；320 測試綠 + verify-quotes.ts 真實 DB 雙商家驗證 |
| 5.7 | MT-M4b：調金額 + 確認（quote_confirmed 事件落地） | ✅ 完成 | 高 | 5.6 | 1d | migration 0005 兩個原子 RPC（confirm_quote / adjust_quote_amount）——Supabase JS 無 transaction，兩個 status 必須原子推進；RPC 內不放業務知識（from/to status 由 transitions.ts 算出後傳入）；調金額以「手動調整」明細列補差額，維持 sum(line_items)==final_amount；PATCH /[id]、POST /[id]/confirm；353 測試綠 + verify-quote-actions.ts 八組斷言（含 rollback 真實證明） |
| 5.8 | MT-M5：Email 寄送（Resend + 報價信模板） | ✅ 完成 | 高 | 5.7 | 1d | confirm_quote 改名重用為 advance_quote_status（+p_set_sent_at，migration 0006）供 confirm/send 共用；renderQuoteEmail 純函式明確斷言（非快照，專案零快照慣例）；sendQuoteEmail 先寄信成功才推進狀態；POST /[id]/send（404/409/502/200）；372 測試綠 + verify-email.ts 對真實 Resend API 實際寄信並人工核對內容 |
| 5.9 | MT-M6：收尾強化 | ✅ 完成 | 中 | 5.8 | 1d | POST /sessions 補 slug 桶；刪除 LINE_*/GMAIL_*/ADMIN_SECRET；landing 加 CTA；新增 /dashboard/settings（isUniqueViolation 抽成共用工具，第三次重複前 DRY）；397 測試綠 + 16 支 verify:* 全數通過；settings 表單互動流程未經瀏覽器驗證（環境限制，見 architect-2026-07-11-1817 決策記錄） |
| **6. 進階功能（重構後 backlog，原 P1 後段）** | | | | | | |
| 6.1 | Pricing Reasoning Agent（區間內加成判斷） | 🔄 階段一完成 | 中 | 5.9 | 3h | SDS §6.3；FR-PR-2；per-merchant 區間 modifier；原任務 4.3。**階段一（確定性求值）已完成**：6 個區間係數中 3 個可由既有欄位確定性判斷（急件＝deadline_days≤3、上色複雜度＝列舉、功能模組＝清單個數），交給 LLM 只是多花錢並引入不確定性（不變式 I-2 的延伸）。另 3 個誠實不處理：印刷檔輸出與高解析度輸出無對應欄位；品牌規範完整度若用 subtype 觸發會與 base_price 的 includes（VI手冊PDF）重複計價。觸發後一律取區間下限（保守，沿用 parseQuantity 慣例），程度判斷留給階段三。**修正的實際問題**：在此之前只認得「授權範圍=X」一種觸發條件，「三天內急件」與「一個月交件」報價完全相同（實測 9000 vs 7800，差 1200）。**階段三（LLM 推理層）未做**：待 6.4 的調價指標累積資料，用「商家是否系統性上調」判斷值不值得做 |
| 6.2 | 程式層區間驗證（超界拒寫 + out_of_scope 轉人工） | ✅ 完成 | 中 | 6.1 | 2h | FR-PR-2 AC、FR-PR-3；NFR-8；原任務 4.4。**刻意先於 6.1 的推理層完成**：鎖要在門打開之前裝好。`validateModifierRatio` 為純函式，閉區間、拒絕而非 clamp（夾住會讓「模型持續產出界值」變成看不見的常態，拒絕才會讓它現形）、區間未定義或反轉一律拒絕（沒有邊界就沒有 bounded autonomy）。所有寫入的倍率都走同一條驗證路徑，即使階段一一律取下限、理論上不可能越界——這樣日後推理層接上時，「已驗證」是結構保證而非慣例。applications 與 ratio 分開：驗證對象是單次套用的倍率，3 模組×0.15=0.45 不該被誤判為超出 [0.15,0.4] |
| 6.3 | 預算護欄（呼叫貴模型前檢查累積成本，記錄不阻擋） | ⏳ 待處理 | 中 | 6.1 | 1.5h | FR-FO-4；原任務 4.5；與 7.4 合併構成成本熔斷敘事 |
| 6.4 | 調價 diff 品質指標化（SQL view + 聚合） | ✅ 完成 | 高 | 5.7 | 0.5d | 「手動調整」明細列已天然記錄 AI 報價 vs 人工定稿差額；建 view 聚合三個指標：調整率（被調價的報價佔比）、平均調幅（%）、隨時間趨勢。零額外標註成本的線上品質 KPI，SQL 直查即可，不做 dashboard。**實作（migration 0010）**：兩個 view，`quote_adjustment_facts`（每張已決定的報價一列）與 `quote_adjustment_monthly`（按商家/類別/月聚合）。**分母只計 confirmed/sent**——未審核的報價算成「未調整」會系統性低估調整率，與 7.2 端到端成功率踩過的是同一種分母錯誤；abandoned 也排除（整張被拒，沒有定稿可比）。**平均調幅只平均有調整者**，把未調整的 0 平均進去得到的是調整率×調幅，無意義。**權限只給 service_role**：view join 了 price_line_items，而 0003 未對 authenticated 開放該表，故瀏覽器查詢為 fail closed；要開放需另行 GRANT，屬擴大攻擊面的決定不隨此 view 順帶進行。`security_invoker = true` 仍保留作為第二道防線。**驗證**：`pnpm verify:adjustment-metrics` 對真實 DB 建兩商家、跑真實 adjust_quote_amount RPC，驗算 ai_amount 還原、分母排除、跨租戶不可見。過程中發現 view 的識別條件依賴「計價明細必帶 rule_id」這個由 0005 註解記載的前提——測試 fixture 因 rate_card_base 的 UNIQUE 約束導致第二列 rule_id 為 NULL，基礎明細被誤判為手動調整 |
| 6.5 | 模型路由（Model Routing） | ⏳ 待處理 | 中 | 6.1 | 2h | Parser / Clarification 用 flash 級模型，Pricing Reasoning 用 pro 級；cost_logs 需能按模型分組比較，產出「路由後成本降 N 倍」的可引用數字 |
| 6.6 | 回退模型鏈（Fallback Model Chain） | ⏳ 待處理 | 中 | 2.5 | 2h | Gemini 主模型失敗/額度耗盡時降級到備援模型（同供應商不同型號即可，MVP 不跨供應商）；對應 SAD R-2 單一供應商風險；與 2.5 既有重試機制整合，重試耗盡才觸發降級 |
| 6.7 | trace_id 貫穿全鏈（session 級軌跡追蹤） | ⏳ 待處理 | 中 | 2.6 | 2h | cost_logs 現況只能看單次呼叫，無法串起一筆 session 跨 Parser → Clarification → Pricing 的完整軌跡；在 cost_logs 加 trace 關聯欄位（沿用 session_id 或新增 trace_id），一支 SQL 可重建完整決策路徑與該 session 總成本。先做 DB 內關聯，接 Langfuse 留待後續評估 |
| 6.8 | Parser 欄位值域約束（subtype 等列舉欄位對齊 rate card） | ✅ 完成 | 高 | 7.1 | 3h | **7.1 golden set 首跑抓到的 HIGH 缺陷**：Parser 未約束值域，抽出「LOGO」「landing page」「公司形象官網」等原文詞，findBase 精確相等查表 → 查無 → outOfScope → final_amount 為 null。**解法選 (a) z.enum 限縮**（否決 (b) 模糊比對：13 個 subtype 誤判代價高，「網站」該對多頁式還是電商？價差 10 倍；否決 (c) findBase 模糊查詢：把猜測藏進 repository 層）。實作：`rateCardRepository.findActiveSubtypes` 新方法 → **orchestrator 查後傳入** parseIntake（刻意不讓 parserAgent 依賴 pricing domain，跨域組裝是 orchestrator 職責）；靜態值域收斂於 `src/shared/constants/fieldDomains.ts`；`includes_` 前綴規則自動涵蓋新增布林欄位（逐一列舉會漏，漏了就靜默退回自由字串）。**最大風險是 enum 逼模型從清單硬選、把誠實缺漏變成自信錯配**，三層防堵：nullable enum + system instruction 明令「不得勉強歸類，填錯選項導致報價錯誤，填 null 只多問一題」+ golden set 三則零資訊案例守著幻覺率。結果：97.1% / 83.3% 全對 / 幻覺維持 0。**殘留 6 項差異（皆不影響當前計價，留待 6.1）**：(1) illu-003「一組貼圖八款」被抽為 quantity=8 → 會算成 8×12000，是真實錯價風險，屬語意理解而非值域問題 (2) graphic-006「一款」未抽出數量（下游 parseQuantity 回退 1，結果相同但會多問一題）(3) feature_modules 分隔符與措辭發散（「金流串接」vs「金流」）——該欄無固定值域，且區間 modifier 尚未使用它，等 6.1 用到時再定格式 |
| **7. Eval / FinOps（核心：指標驅動開發；dashboard 維持不做）** | | | | | | |
| 7.1 | Golden Set（30-50 則標註案例，版本化存 repo） | ✅ 完成 | 高 | 5.9 | 3h | FR-EV-1；36 則（每類 12）存 `src/domains/eval/`，依 category 分檔；標註只記 value 與缺漏（不標 confidence——人無法可靠標註模型把握度，改由幻覺率間接檢驗）；**標註正規化約定**寫在 goldenSet.types.ts，7.2 比對邏輯必須遵守；核心不變式由測試強制：缺漏清單必須恰等於 value=null 的欄位、subtype 必須存在於 rate card、欄位集合必須等於 requiredFieldsFor(category)；verify:golden-set 對真實 Gemini 跑全 36 則印基準線（刻意不斷言、不寫 eval_runs——指標契約未定案前不固化實作）。**關鍵教訓**：verify script 的正規化必須對齊下游真實邏輯（沿用 basePricing 的 normalizeLicenseScope 與 parseQuantity 回退），否則「商業用途 vs 商業使用」會被記為錯誤但下游其實算對，指標淪為假警報；反之 subtype/feature_modules 刻意不正規化，因為下游真的會出錯，必須讓它現形 |
| 7.2 | Eval Runner（跑真實 pipeline + 指標計算，寫 eval_runs） | ✅ 完成 | 高 | 7.1 | 4h | FR-EV-2；`pnpm eval`（`--dry-run` 不寫入 / `--limit=N` 省 token / `--delay=` 調節流）。分層：`metrics.ts`+`normalization.ts`+`comparison.ts`+`metricRows.ts` 皆純函式（39 項單元測試，用手算小數字驗證公式，不需碰 Gemini/DB），`evalRunner.ts` 負責 IO 編排。**metric_name 是對外契約**（SQL 直查/跨次比較/8.5 閘門都依賴），由測試釘住 11 個名稱。null 指標仍寫入——「沒跑」與「跑了但分母為 0」是不同事實。附帶重構：`normalizeLicenseScope` 從 basePricing 抽到 `licenseScope.ts`（純函式不該被 DB 依賴鏈綁住，eval 要重用它才不會拉進 Supabase client）。**已知限制**：延遲僅涵蓋 Parser 呼叫，不含反問生成的端到端時間（要量得跑完整流程，成本高數倍，留 backlog）。**附帶治理（2026-07-19）**：eval session 以 `contact_email = eval@bizmate.local` 標記（不加 is_test 欄位——8.6 migration 管線未建立，加欄位得手動套 production），`pnpm eval:clean` 清理（預設 dry-run，`--confirm` 才刪，`--legacy` 處理標記機制上線前的孤兒）。**安全設計**：sessions 子表全為 CASCADE 且含 quotes，故刪除前必先數連帶報價數，大於 0 即中止；cost_logs 為 SET NULL 故成本紀錄保留（成本確實發生，FinOps 統計不該因清理測試資料而失真）。已對真實 DB 端到端驗證：建 3 筆→辨識 3 筆→刪 3 筆，quotes 維持 5 筆未受影響 |
| 7.3 | ~~Eval Dashboard~~ | ⏭️ 作廢 | - | - | - | 降級：verify script / SQL 直查 |
| 7.4 | 免費層額度追蹤（每日用量 vs 上限） | ⏳ 待處理 | 中 | 2.6 | 1.5h | FR-FO-3；SQL 直查 |
| 7.5 | ~~FinOps Dashboard~~ | ⏭️ 作廢 | - | - | - | 降級：SQL 直查 cost_logs |
| **8. 貫穿性任務（每階段並行）** | | | | | | |
| 8.1 | 單元 + 整合測試（TDD，80%+ 覆蓋率） | 🔄 進行中 | 高 | 各實作 | 貫穿 | 現況 372 測試綠；每個 5.x 任務先寫測試；跨租戶隔離是 5.5+ 的必測項（5.5/5.6/5.7 已補齊）。**教訓（5.7）**：verify script 若全走 service，DB 層的守衛（RPC 的 CAS/WHERE）會因應用層短路而從未被觸發——防禦縱深的第二道防線必須獨立驗證。**教訓（5.8）**：涉及真實第三方 API（Resend）的功能，mock 測試無法證明「內文渲染正確」「reply-to 真的送達」——verify script 需真的呼叫外部 API + 人工開信箱核對。**教訓（7.1）**：424 個綠燈單元測試 + 通過的 E2E 金路徑，都沒抓到 Parser 抽取值與 rate card 值域不匹配（→ 6.8）——因為單元測試餵的是自己寫的乾淨 fixture，E2E 只斷言流程走得完、不斷言報價金額品質。**對 LLM 輸出的品質，只有跑真實模型的標註資料集擋得住**，這正是 golden set 的價值所在 |
| 8.2 | E2E 測試（Playwright，關鍵使用者流程） | ✅ 完成 | 中 | 5.8 | 4h | 對真實 dev stack（Supabase/Gemini/Resend）跑通金路徑：登入→onboarding→改價→匿名 /q/{slug} 出報價→後台確認→寄信；獨立重跑驗證通過、DB 無殘留。**環境事實更正**：5.9 記錄的「無瀏覽器工具」已過時，headless Chromium/WebKit 實測可用。此 dev Supabase 專案整站關閉公開註冊（signup_disabled），金路徑改走 admin 預備已確認帳號 + `/login`（與 verify-auth.ts 慣例一致），`/signup` UI 另有獨立輕量測試覆蓋；完整報告見 `.claude/context/e2e/e2e-validation-specialist-2026-07-13-1035-wbs-8-2-critical-path.md` |
| 8.3 | 安全審查（prompt injection 三層防禦 + OWASP + RLS 複核） | ✅ 完成 | 高 | 5.9 | 2h | NFR-8；security.md；未發現 Critical/High；14/14 表 RLS 全開、四張無 merchant_id 子表隔離不變式複核成立；修復 M1（RPC 對 PUBLIC 開放 EXECUTE，migration 0007 已套用+verify:security 驗證通過）、M2（postcss XSS，pnpm override 修復，audit 歸零）；M3（prompt injection，已有三層緩解降級 Medium）與 L4-L7 留 backlog；完整報告見 `.claude/context/security/security-infrastructure-auditor-2026-07-13-1010-wbs-8-3-review.md` |
| 8.4 | 部署（Vercel + Supabase 免費層，實測執行上限） | 🔄 進行中 | 高 | 5.9 | 2h | NFR-3；含 Resend 網域驗證（SPF/DKIM）；CI 接入待辦已獨立為 8.5；作品集前提：需產出可公開訪問的 URL；含 Vercel 超時實測（SAD R-1）；含 production 專案 migration 基線盤點（0001–0007 現況為手動套用，上線前確認 production schema 與 repo migrations 一致，供 8.6 自動化管線接手）；**部署決策（2026-07-16）**：Supabase 免費層 2 專案上限、另一名額為作品集網站，故 BizMate 沿用現有專案升格 prod（不新建、不刪除），dev/prod 共用同一專案（免費層限制下的取捨）；詳見 docs/deployment.md。**進度（2026-07-19）**：使用者回報 Vercel 部署本身已完成（含 6.8 修復，origin/main 已同步至 7201f9f）。**尚未執行的驗收項**：(1) 冒煙測試六項（首頁／login／匿名 /q/{slug} 走完一筆報價觸發 Gemini／後台確認+寄信觸發 Resend／改價後新報價反映）(2) Vercel 超時實測 SAD R-1（describe/answer 實際執行秒數、確認無 504）(3) production migration 基線核對（db:verify + verify:security）(4) production URL 尚未記錄於文件。**共用 DB 的副作用已處理**：7.2 附帶加上 eval 測試資料標記與 `pnpm eval:clean`，避免 8.5 接 CI 後測試 session 無限累積污染 production。**🚫 阻塞（2026-07-19 實際撞到）**：Resend 網域驗證尚未完成，`EMAIL_FROM` 目前為共用測試地址 `onboarding@resend.dev`，該模式下 Resend 只允許寄給帳號持有人信箱（ychsieh0725@gmail.com），寄給真實客戶一律被拒（錯誤訊息明確要求 verify a domain）。**影響**：冒煙測試第 4 項（後台確認+寄信）無法用真實客戶信箱驗收；產品實質無法對外服務。**解除條件**：取得自有網域 → Resend 後台加 Domain → DNS 加 SPF/DKIM 記錄 → 驗證通過 → `EMAIL_FROM` 改為該網域地址（本機 .env.local 與 Vercel 環境變數都要改）。**目前無網域，此項待採購**。**非阻塞的部分**：程式碼實作正確且失敗處理妥當——寄信失敗時 quote 停在 confirmed 不推進狀態，端點天然冪等，網域就緒後回後台重按「寄送給客戶」即可重寄，無需資料修復；開發階段可在報價向導 Step 2 填自己的信箱完整驗證金路徑，跑 `verify-email.ts` 則需在 .env.local 另設 `VERIFY_EMAIL_RECIPIENT` |
| 8.5 | verify:* scripts + Eval Runner 接進 GitHub Actions CI | ✅ 完成 | 高 | 8.4, 7.2 | 3h | 修復 5.6 code review 指出的靜默回歸窗口（租戶隔離只由手動腳本守門，repository 層刪掉 merchant_id 過濾時單元測試不會紅）。**兩道閘門，分在兩支 workflow**：(1) `ci.yml` 的 `real-dependencies` job 對真實 dev Supabase 跑 9 支純 DB 的 verify 腳本；(2) 新增 `eval.yml` 跑全量 36 則 golden set 並對基準線判定。**分開的理由**：eval 需 Gemini 額度且約 5 分鐘，用 paths 篩選只在 `src/domains/{eval,intake,pricing}`、`src/orchestrator`、`agent-service/app` 變更時觸發，另加 nightly（02:00 台北）與 workflow_dispatch。**已知代價**：paths 未命中時該 workflow 完全不出現在檢查清單，故不可設為 branch protection 的必要檢查，否則不相關的 PR 會永遠等待。**fork PR 一律跳過**（`head.repo.full_name == github.repository`）；否決 `pull_request_target`，那等於把 service_role key 交給任何開 PR 的人。**門檻取 Wilson 95% 下界而非觀測值**——這是被資料逼出來的：同一資料集同一模型，08-17 與 08-18 兩次量測的欄位準確率是 199/204 與 201/204，門檻設在觀測值 98.5% 會讓 08-17 那次紅燈，而那次沒有任何東西壞掉；會誤報的閘門會被關掉，關掉的閘門等於沒有閘門。實際門檻（`src/domains/eval/baseline.ts`，出處 `eval-artifacts/a6b-baseline.json`）：accuracy/F1 ≥ 0.9577、clarification_recall ≥ 0.9324、hallucination_rate ≤ 0（硬性）、end_to_end_success_rate ≥ 0.9036、quote_deviation_max ≤ 0.10（刻意不設 0，單一欄位抽錯就會跳動；設 10% 仍擋得住 illu-003 那種 700%）。**成本與延遲降為 advisory**：兩次量測的 P95 是 2,093ms 與 11,010ms（5.3 倍），成本只差 6%——延遲的變異來自 Gemini 服務端排隊，當閘門只會製造噪音。**閘門的測試用真實歷史 artifact**（`baseline.test.ts`）：`a6-baseline.json` 必須被擋、`a6b-baseline.json` 必須放行。連帶效果是「調鬆門檻」這件事本身被測試守著。**指標為 null 一律不算通過**——資料集載入壞掉時全部指標成 null，把「量不到」當「通過了」是這類閘門最典型的失效方式（已用 `--limit=3` 實測驗證會擋下）。**跑與判分成兩支**（`pnpm eval --out=` 與 `pnpm eval:gate <file>`）：那份資料花了額度與 5 分鐘換來，閘門紅燈時最需要它，不能因為紅燈就沒了；CI 一律 upload-artifact 保留 30 天。PR 上加 `--dry-run` 不寫 eval_runs（基準線的時間序列不該混入未合併的實驗），main 與排程才寫入。**附帶治理**：新增 `pnpm verify:clean`（預設 dry-run、`--confirm` 才刪、預設 2 小時保護期），補上 verify 腳本在中斷路徑的缺口——9 支都有 try/finally 自清，但 job 被取消或逾時時 finally 不會跑。挑選條件為純函式並由單元測試守著，最危險的一則是 `dev@bizmate.local` 與 `verify-*@bizmate-test.local` 只差一個 `-test`，判斷錯誤會沿 CASCADE 刪掉真實資料。`verify:email` 刻意不進 CI（會真的寄信，且 8.4 網域未驗證）；6 支需 Gemini 的 verify 也不進（驗的是「真實模型呼叫走得通」，eval 每次 36 則已涵蓋，重複燒額度）。**環境事實更正**：eval 不需要 `pnpm dev` 起著——`evalRunner` 直接 import `parseIntake` 與 `computeBasePricing`，是 in-process 呼叫。package.json 全面改用 `--env-file-if-exists`，CI 從 job env 注入，不落任何金鑰到磁碟。**使用者需在 repo 設定 6 個 Secrets**：SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY、DEV_MERCHANT_PASSWORD、GEMINI_API_KEY |
| 8.6 | DB migration 部署管線（migration 先行於程式碼部署） | ⏳ 待處理 | 高 | 8.4, 8.5 | 2h | Vercel 只部署程式碼、不跑 Supabase migrations；GitHub Actions 於 merge to main 時先執行 migration 套用（supabase db push 或等效腳本），成功後才放行 Vercel 部署。並確立 migration 向後相容約定：新欄位可空、不直接改名/刪欄，確保「舊代碼 + 新 schema」過渡窗口安全。production migration 基線盤點在 8.4 上線時完成（見該項備註），本任務承接基線之後的自動化管線 |

### 狀態說明
- ✅ 完成　🔄 進行中　⏳ 待處理　🚫 阻塞　⏭️ 跳過/作廢

---

## 里程碑

| 里程碑 | 目標 | 包含任務 | 狀態 |
|--------|------|----------|------|
| M0: 基礎設施就緒 | Next.js + Supabase + client 封裝可運行 | 2.1-2.7 | ✅ 完成 |
| M1: P0 Happy Path | 完整走完「選項目→描述→deterministic 報價」 | 3.1-3.7 | ✅ 完成 |
| P1 前段 | 反問迴圈 + 保守估價 | 4.1-4.2 | ✅ 完成 |
| **MT-M1: 多租戶地基** | DB 重寫 + merchantId 貫穿 + /q/{slug} 入口 | 5.1 | ✅ 完成（779741d） |
| **MT-M2: 註冊登入可用** | 註冊→自帶範本價目表→拿到分享連結→無痕視窗完成一筆報價 | 5.2-5.4 | ✅ 完成 |
| **MT-M3: 服務自管** | 改價後新報價即反映；跨租戶隔離驗證 | 5.5 | ✅ 完成 |
| **MT-M4: 後台終審** | 客戶送單→後台看到→調金額→確認 | 5.6-5.7 | ✅ 完成 |
| **MT-M5: 報價寄達** | 確認→客戶信箱收到報價信→quote 進終態 sent | 5.8 | ✅ 完成 |
| MT-M6: 產品收尾 | rate limit 強化 + env 清理 + landing/settings | 5.9 | ✅ 完成 |
| 進階與上線 | Pricing Agent + E2E + 安審 + 部署 | 6.x, 8.2-8.4 | 🔄 進行中（8.2/8.3 已完成） |
| **Portfolio-Ready** | 線上可訪問 + CI 雙閘門 + 指標驅動證據齊備 | 8.4, 8.5, 8.6, 7.1, 7.2, 6.4 | ⏳ 待處理 |

> 每個 MT 里程碑收尾流程：feat 分支 → TDD → verify script 實測 → commit（WHY/WHAT/IMPACT）→ `--no-ff` 併回 main → 刪分支。

---

## 風險與阻塞

| 風險 | 影響 | 緩解策略 |
|------|------|----------|
| Supabase Auth cookie/SSR 整合細節（Next 16） | 登入態不穩、middleware 失效 | 嚴格照 @supabase/ssr 官方樣板；5.2 先做最小可跑再擴 |
| RLS policy 誤設或遺漏 | 跨租戶資料外洩 | 應用層 requireMerchant 為主保證、RLS 為第二道；5.4 附 verify-auth.ts 用 A 商家 JWT 實測只回 A 的列 |
| slug 撞名 / 保留字 | 分享連結衝突或蓋到系統路由 | wizard 掛 /q/ 命名空間下天然隔離；slug 生成碰撞重試；PATCH profile 衝突回 409 |
| Resend 免費額度（100 封/日）與網域驗證 | 寄信失敗或進垃圾桶 | MVP 夠用；部署時完成 SPF/DKIM（8.4）；寄失敗停在 confirmed 可重寄 |
| Vercel Hobby 單次執行上限 | 長 LLM 呼叫被 504 截斷 | NFR-3：單 function 單呼叫；部署階段實測（SAD R-1） |
| Gemini 免費層額度政策變更 | 成本假設失效 | MODEL_PRICING 設定外置；7.4 額度追蹤（SAD R-2） |
| 範本價目表數字不合各商家行情 | 新商家用預設價亂報 | 範本僅為起始值；5.5 後台改價即生效；onboarding 文案提醒調整 |
| Gemini 免費層 15 RPM 速率限制 | Eval Runner / CI 跑整份 golden set 必然撞 429 中斷 | 7.1 已實測撞到；verify:golden-set 內建 4.5s/則節流（約 13 RPM，36 則約 3 分鐘）；7.2/8.5 需沿用節流或改併發控制，CI 若要縮時需評估付費層 |
| migration 與程式碼部署順序無系統保證 | 程式碼上線但 schema 未更新，production 故障 | 8.6：CI 中 migration 先行後才放行部署；migration 向後相容約定（新欄位可空、不改名刪欄） |

---

## 待確認事項（開發中校準，不阻塞啟動）

1. Clarification 輪數上限與 confidence 門檻的實際數值 — 需 golden set 校準（7.1-7.2）
2. Email 寄送網域（用 Resend 共用網域先跑，或及早買自有網域做 DKIM）— 8.4 部署前決定
3. ~~商家刪除服務項目時，既有引用該 rule_id 的報價如何顯示~~ — 5.5 已拍板並實作：軟刪除（`is_active` 標記），不做真實 DELETE（`price_line_items.rule_id` 對 `rate_card_base` 的 FK 是 `NO ACTION`，真實刪除會被擋下，已用 verify-services.ts 對真實 DB 證實）
