# code-quality-specialist 報告

- **日期**: 2026-07-11 18:25
- **任務**: feat/mt-m6-wrapup 分支 code review（3d0bc1c..feat/mt-m6-wrapup）
- **範圍**: rate limit 雙桶、env 清理、isUniqueViolation 抽取、landing CTA、`/dashboard/settings`（API+UI+verify script）

## 結論

**品味評分 🟡，0 CRITICAL / 1 HIGH / 2 MEDIUM / 3 LOW。**

已確認通過的重點審查項：

- `isUniqueViolation` 抽取乾淨——兩個既有呼叫點（`resolveAfterParse.ts`、`services/route.ts`）正確改 import，無孤兒重複定義。
- rate-limit 改動無測試副作用——舊 bucket key 全 repo 無殘留引用，既有測試不受影響。
- settings 端點安全性——`requireMerchant()` 守門、`update()` 綁定當前租戶無 IDOR、zod strip 未知欄位無 mass-assignment、public_slug regex 與 DB CHECK/UNIQUE 完全對齊。

## 已處理的問題

- **HIGH（slug 限流桶沿用 IP 桶規則 10次/小時）**：slug 桶是跨全商家客戶合計計數，生意好的商家可能誤傷第 11 位真實客戶。此為使用者先前已拍板的決策，未逕自變更，帶回使用者覆核後**維持原決定**（MVP 階段目標用戶流量不易觸及此上限，真的碰到再調）。
- **MEDIUM（SettingsForm SSR/client hydration mismatch）**：`typeof window !== "undefined"` 判斷 origin 顯示與否，SSR 與 client 渲染輸出不一致。**已修復**（commit `db3b555`）：移除 origin 拼接，只顯示相對路徑，徹底消除分歧來源。
- **MEDIUM（SettingsForm 零元件測試）**：沿用專案既有慣例（UI 元件本就無測試，測試集中在 route/service/schema 層），非本次任務新增缺口，維持現狀。
- **LOW ×3**：改 slug 靜默失效舊連結（UX）、`display_name` 未 trim（與既有 onboarding 一致）、slug 桶在查 merchant 前就計數（受 IP 桶封頂非真實風險）——記錄備查，不阻擋合併。

## 行動項目

- [ ] 合併後找時間人工瀏覽器走一次 settings 表單互動流程
- [ ] 若觀察到 slug 桶誤傷合法流量，回頭把規則與 IP 桶脫鉤
- [ ] UI 元件測試技術債（SettingsForm 及既有元件）留待未來整批處理

## 影響評估

- **嚴重度**: MEDIUM（1 個 HIGH 已覆核維持原決定並記錄理由；1 個 MEDIUM 已修復；其餘為既有慣例或低風險）
- **影響範圍**: `src/app/api/sessions`、`src/lib/env.ts`、`src/app/page.tsx`、`domains/merchant` 與 `app/dashboard/settings` 新模組
