# MT-M2c：requireMerchant 守門 + RLS owner policies + dashboard 骨架 — 設計文件

**日期：** 2026-07-10
**對應 WBS：** 5.4 MT-M2c
**對應計畫：** `documents/BizMate_多租戶重構計畫_v1.0.md` §2（RLS 策略、requireMerchant）
**依賴：** 5.3 MT-M2b（已完成，併入 main）

## 背景與目標

MT-M2 里程碑最後一步。5.2 完成認證、5.3 完成 onboarding，現在需要：
1. 補齊 dashboard API 的標準守門工具 `requireMerchant`（未來 5.5+ 服務項目/報價 API 的第一行呼叫）
2. 加上 RLS owner policies，作為「防禦縱深」第二道防線
3. `/dashboard` 從 placeholder 升級為真正骨架：待審報價數 + 分享連結一鍵複製

完成後即達成 MT-M2 完整驗收路徑：註冊→自帶範本價目表→拿到分享連結→無痕視窗完成一筆報價。

## 關鍵限制（設計期間發現）

`supabase/migrations/0001_init.sql` 目前只 `GRANT ALL PRIVILEGES ... TO service_role`，`authenticated` 角色完全沒有表級權限。Postgres 存取控制需要**表級 GRANT** 與 **RLS policy** 同時成立，缺一都會查無資料。因此 migration 0003 除了 `CREATE POLICY` 還必須同步 `GRANT SELECT ... TO authenticated`。

## 範圍邊界

**包含：**
- `supabase/migrations/0003_owner_policies.sql`：`merchants`/`rate_card_base`/`rate_card_modifiers`/`quotes`/`sessions` 五張表的 SELECT owner policy + GRANT SELECT
- `src/lib/auth/requireMerchant.ts`
- `/dashboard` 骨架：待審數 + 分享連結一鍵複製
- `scripts/verify-auth.ts`：自動化 RLS 隔離驗證

**明確不含：**
- `raw_inputs`/`extracted_fields`/`clarification_turns`/`price_line_items`（經 `session_id` 間接歸屬，計畫文件範圍本就不含，深層 join policy 留待真正需要時再做）
- INSERT/UPDATE/DELETE 權限（寫入仍全部走既有 `service_role` repository 模式，不擴大攻擊面）
- 5.5+ 的服務項目 CRUD（僅預留 `requireMerchant` 供其呼叫）

## 架構決策：RLS 是防禦縱深，不是主要機制

依計畫文件明文：「RLS 策略（防禦縱深，主保證仍是應用層 `requireMerchant` + service_role）」。這代表：

- **主要保證**：`requireMerchant` 用 service_role（透過既有 `merchantsRepository`）查詢 merchant，應用層邏輯自行過濾 `merchant_id`——延續 5.1-5.3 已建立的模式，不改動任何現有 repository 的 client 類型。
- **第二道防線**：RLS owner policy + GRANT SELECT，讓已登入使用者即使繞過我們的 Next.js app、直接用 anon key + 自己的 JWT 打 Supabase 的公開 REST API，也只能讀到自己的資料——防的是「app 之外的路徑」，不是「app 內部忘記過濾」（app 內部本來就不受 RLS 管，因為用 service_role）。
- 因此本任務**不需要**把任何現有 repository 改成 session-based client；`requireMerchant` 本身也用 service_role 查 merchant 存在性（同 `proxy.ts`、`onboardMerchant.ts` 的既有模式）。

## 資料流

### migration 0003
- `merchants`：`CREATE POLICY merchants_owner_select ON merchants FOR SELECT TO authenticated USING (auth.uid() = id);` + `GRANT SELECT ON merchants TO authenticated;`
- `rate_card_base`、`rate_card_modifiers`、`quotes`、`sessions`：同樣 `FOR SELECT ... USING (auth.uid() = merchant_id)` + `GRANT SELECT`

### requireMerchant
```ts
type RequireMerchantResult =
  | { ok: true; merchantId: string }
  | { ok: false; status: 401 | 403 };
```
1. `serverClient.createClient().auth.getUser()` — 查無使用者 → `{ ok: false, status: 401 }`
2. `merchantsRepository.findById(user.id)` — 查無 merchant → `{ ok: false, status: 403 }`
3. 兩者皆有 → `{ ok: true, merchantId: user.id }`

呼叫端（route handler）用法：
```ts
const auth = await requireMerchant();
if (!auth.ok) {
  return apiFail(auth.status === 401 ? "請先登入" : "查無商家資料", auth.status);
}
```

### /dashboard 骨架
- `page.tsx`（Server Component）：呼叫 `requireMerchant()`（理論上 middleware 已擋掉未登入/無 merchant，這裡是防禦性二次確認，401/403 時顯示簡單錯誤訊息，不特別做導頁，因為正常流程不會走到）→ `merchantsRepository.findById(merchantId)` 拿 `public_slug` → `quotesRepository.countByStatus(merchantId, "awaiting_review")` 拿待審數
- `quotesRepository` 新增 `countByStatus(merchantId, status)`（比照既有 `countByCodePrefix` 寫法）
- `CopyLinkButton.tsx`（Client Component）：接收 `slug` prop，組出完整 `/q/{slug}` URL，`navigator.clipboard.writeText` + 短暫「已複製」文字回饋

### verify-auth.ts
比照 `verify-db.ts` 慣例（`pnpm tsx --env-file=.env.local scripts/verify-auth.ts`）：
1. 用 Admin API 建商家 A、B（各自 email_confirm 直接建立，不寄信）
2. 分別呼叫 `onboardMerchant` 邏輯（或直接 repository 操作）讓 A、B 各自有 `rate_card_base` 資料
3. 用 A 的帳密登入拿真實 JWT（`signInWithPassword`）
4. 建立「anon key + A 的 JWT」的 Supabase client（非 service_role），直查 `rate_card_base`
5. 斷言：回傳列全部屬於 A（`merchant_id === A.id`），且筆數等於 A 自己建立的筆數（證明查不到 B 的列）
6. 清理：Admin API 刪除 A、B（`merchants`/`rate_card_base` 隨 FK `ON DELETE CASCADE` 一併清除）

## 錯誤處理

- `requireMerchant` 內部呼叫失敗（如 Supabase 網路異常）：與 `middlewareClient.ts` 的 fail-closed 原則一致，任何例外一律視為未通過（401），不可 fail open
- migration 手動於 Supabase SQL Editor 執行（同 0001、0002 慣例），非自動化 migration runner

## 測試

- `requireMerchant.ts`：TDD，mock `serverClient`/`merchantsRepository`，涵蓋 401（無 session）、403（無 merchant）、成功三案例
- `quotesRepository.countByStatus`：沿用既有 repository 測試慣例（若既有 `countByCodePrefix` 無獨立測試，此方法也不另開，行為由 route/page 整合測試或 `verify-auth.ts` 間接涵蓋）
- `/dashboard`、`CopyLinkButton.tsx`：UI，依專案慣例不寫 vitest 單元測試，留待手動瀏覽器驗證
- `verify-auth.ts`：本身就是驗證腳本，非 vitest 測試，跑一次即是「測試」
