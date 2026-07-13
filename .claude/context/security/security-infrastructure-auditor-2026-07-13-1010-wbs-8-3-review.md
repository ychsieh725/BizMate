# Security-Infrastructure-Auditor 報告

- **日期**: 2026-07-13 10:10
- **任務**: WBS 8.3 安全審查（上線前，prompt injection 三層防禦 + OWASP Top 10 + RLS 複核）
- **範圍**: `src/app/api/**`、`src/lib/auth/`、`src/lib/rateLimit/`、`src/lib/email/`、`src/domains/intake/`、`src/lib/gemini/`、`supabase/migrations/0001-0006`、依賴（pnpm audit）

## 結論

- 未發現 Critical / High 漏洞。多租戶隔離縱深設計（requireMerchant 應用層 + RLS + proxy + 頁面/API 雙重把關）健全；14/14 張表 RLS 全開，policy-less 表皆為刻意 service_role-only 模型，非遮蔽 bug。
- 四張無 `merchant_id` 子表（raw_inputs/extracted_fields/clarification_turns/price_line_items）的隔離不變式仍成立：唯一入口 `quoteReviewService`/`quoteActionsService` 皆先驗 quote/session 歸屬，無 API route 或頁面直查子表。
- **M1（Medium）**：`advance_quote_status`/`adjust_quote_amount`/`increment_rate_limit` 三個 RPC 對 PUBLIC 開放 EXECUTE（Postgres 預設），已逐條核對 grant **確認目前不可利用**（SECURITY INVOKER + anon/authenticated 對底層表無寫入權限 → 卡在函式體內第一個寫入語句）。仍屬防禦縱深負債，已修復（見下）。
- **M2（Medium）**：`postcss <8.5.10`（經 `next` 引入）有已知 XSS 漏洞（GHSA-qx2v-qp2m-jg93）。已修復。
- **M3（Medium，backlog）**：`buildAugmentedText`（`src/orchestrator/answerFlow.ts:31-38`）將客戶回答明文串入 prompt，理論上可被結構化字串注入影響抽取結果（例如壓低 license_scope 級距）。三層防禦大致到位（zod 長度上限、systemInstruction 明確框定 raw_text 非指令、輸出面 responseJsonSchema + zod 強制形狀 + 商家人工終審才送出），故降級為 Medium 而非 High。最壞情況是報價數字偏差，會被人在 `awaiting_review` 審核攔截；無 XSS（無 `dangerouslySetInnerHTML`）。
- L4-L7（Low）：describe/answer 端點無獨立限流（受上游 session 建立限流 bound）、`x-forwarded-for` 信任（Vercel 部署下安全）、限流 fail-open（明確取捨）、公開 session UUID 為唯一憑證（匿名 wizard 設計）。均可接受，記錄即可。

## 行動項目

- [x] M2 修復：`pnpm-workspace.yaml` 加 `overrides: { postcss: '>=8.5.10' }`，`pnpm audit` 驗證歸零，397 測試 + build + lint 全綠。
- [x] M1 migration 草擬：`supabase/migrations/0007_revoke_public_execute.sql`（REVOKE EXECUTE FROM PUBLIC + 顯式重申 GRANT TO service_role，含 `increment_rate_limit` 原本缺失的顯式 grant，冪等）。
- [x] 新增 `scripts/verify-security.ts` + `pnpm verify:security`：以 anon/authenticated 兩種身分直呼三個 RPC，斷言錯誤訊息為 `permission denied for function`（而非 `for table`）——刻意排除「今天套用前就已成立」的偽陽性，只有 EXECUTE 本身被擋下才通過。已跑過確認**套用前如預期失敗**（`permission denied for table quotes`），驗證腳本本身具鑑別力。
- [ ] **待使用者**：於 Supabase Studio SQL Editor 手動套用 `0007_revoke_public_execute.sql`，套用後跑 `pnpm verify:security` 應轉為全數通過。
- [ ] M3（backlog）：prompt 加隨機 nonce fence 包裹客戶文字；審核 UI 對「客戶輸入 vs 系統推導」欄位做視覺區隔。
- [ ] L4（backlog，視成本）：對 `/describe`、`/answer` 補 per-session 呼叫次數上限。

## 影響評估

- **嚴重度**: MEDIUM（無 Critical/High；M1/M2 已修復，M3 為已有多層緩解的 backlog 項目）
- **影響範圍**: `supabase/migrations/`（新增 0007，未套用）、`pnpm-workspace.yaml`、`package.json`（新增 verify:security）、`scripts/verify-security.ts`（新增）；不影響既有功能程式碼路徑。
