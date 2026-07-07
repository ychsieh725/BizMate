# Plan Agent 報告 — 多使用者 SaaS 重構

- **日期**: 2026-07-07 15:30
- **任務**: 評估「單一接案者 → 多使用者 SaaS」重構策略並產出實作計畫
- **範圍**: 全專案（DB schema、orchestrator、domains、API、前端）

## 結論

- **沿用現有程式碼重構，不重寫**：分層乾淨、tenant 注入點集中；LINE 鏈只存在於 schema 與 env（`src/` 內零 LINE 程式碼），砍掉成本極低。唯一重寫的是 migrations（無真實資料，直接重建）。
- 已拍板：終審改網頁後台（砍 LINE 4.6–4.11）｜Supabase Auth｜DB 重寫重建｜Eval/FinOps 降級內部工具。
- 資料模型：新增 `merchants`（id = auth.users.id，1:1，含 `public_slug`）與 `rate_card_template_*` 全域範本表；`sessions`/`rate_card_*`/`quotes` 加 `merchant_id NOT NULL`；淘汰 `line_binding`/`revision_turns`。
- 狀態機 9 態 → 8 態：刪 `revising`，`awaiting_freelancer` → `awaiting_review`，新增事件 `quote_confirmed`。
- merchantId 呼叫鏈：入口（slug）解析一次掛在 session 上，中游 flow 從 session 讀取。
- Email 改 Resend（棄 Nodemailer + Gmail：serverless 不友善、單帳號思維）。
- 分六個 milestone（M1 DB+貫穿 → M2 Auth → M3 服務 CRUD → M4 報價審核 → M5 Email → M6 收尾），完整計畫見 `/Users/xieyuquan/.claude/plans/fizzy-baking-map.md`。

## 行動項目

- [x] M1 開工：feat/multi-tenant-m1 分支
- [ ] M2–M6 依計畫執行

## 影響評估

- **嚴重度**: HIGH（全專案重構）
- **影響範圍**: 所有層——migrations 重寫、狀態機改造、repositories 簽章、API 入口、前端路由
