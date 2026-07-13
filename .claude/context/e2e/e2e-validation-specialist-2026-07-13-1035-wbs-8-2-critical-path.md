# E2E-Validation-Specialist 報告

- **日期**: 2026-07-13 10:35
- **任務**: WBS 8.2 E2E 測試（Playwright，關鍵使用者流程）
- **範圍**: `playwright.config.ts`、`tests/e2e/**`、9 個元件加 `data-testid`（login/signup/onboarding/services/wizard/quotes）

## 結論

- 首次在此專案建立 Playwright E2E 基礎設施，對**真實** dev stack（真實 Supabase + 真實 Gemini + 真實 Resend，非 mock）跑通完整金路徑：登入 → onboarding（複製範本價目表）→ 改價（UI + DB 雙重驗證持久化）→ 匿名客戶跑 `/q/{slug}` 出報價（未觸發反問）→ 後台確認 → 寄信（真實 Resend，`sent_at` 落地）。獨立重跑一次確認與 agent 報告一致，且清理後 DB 無殘留測試資料。
- **環境事實更正**：5.9 milestone 記錄的「環境無瀏覽器工具」已過時/不適用於本環境——Playwright headless Chromium/WebKit 經 smoke test 證實可正常啟動與操作，此次即為實測證據。
- **註冊流程**：探測發現此 dev Supabase 專案**整站關閉公開註冊**（`422 signup_disabled`），非單純 email 驗證開關問題。金路徑因此改用 `service_role admin.createUser({ email_confirm: true })` 預備帳號 + 走 `/login` 進場（與 `scripts/verify-auth.ts` 既有慣例一致）；`/signup` UI 本身另有獨立輕量測試覆蓋（斷言優雅顯示錯誤，非白畫面）。
- **已知次要 UX gap（未修，記錄即可）**：`toFriendlyAuthError`（`src/lib/auth/authErrorMessages.ts`）未對應 `signup_disabled` 錯誤碼，目前顯示通用「發生未預期的錯誤」。不影響核心流程，可留給下次觸碰該檔案時順手補。
- **Next 16 已知坑**：`page.waitForURL()` 對 server-action `redirect()` 的 soft navigation 不可靠會逾時；改用元素式等待（等待目標頁面特徵元素出現）迴避，僅影響 E2E 測試撰寫方式，非應用程式 bug。

## 行動項目

- [x] `playwright.config.ts`：webServer 自動起 `pnpm dev`，chromium 單一 project、workers=1、retries=0（避免燒 rate limit / Resend 額度）。
- [x] `tests/e2e/critical-path.spec.ts` + `signup.spec.ts` + Page Object Model（`tests/e2e/pages/`）+ 測試資料 admin 層（`tests/e2e/support/`，含完整 cleanup）。
- [x] 9 個元件補 `data-testid`（純標記新增，無邏輯變更，397 單元測試 + lint + build 全綠）。
- [x] `package.json` 加 `test:e2e` / `test:e2e:report`。
- [ ] （backlog，低優先）`toFriendlyAuthError` 補 `signup_disabled` 對應的友善訊息。

## 影響評估

- **嚴重度**: LOW（純新增測試基礎設施 + 標記，不影響既有功能路徑）
- **影響範圍**: 9 個既有元件（僅加屬性）、新增 `playwright.config.ts`、`tests/e2e/`；`vitest.config.ts` 的 include 範圍已確認限定 `src/**`，與 E2E 測試無衝突。
