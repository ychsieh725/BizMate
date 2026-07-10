# MT-M2a：認證基建 — 設計文件

**日期：** 2026-07-10
**對應 WBS：** 5.2 MT-M2a
**對應計畫：** `documents/BizMate_多租戶重構計畫_v1.0.md` §2、§4
**依賴：** 5.1 MT-M1（已完成，779741d）

## 背景與目標

多租戶重構計畫的 M2 里程碑第一步。目前 `/dashboard`、`/login`、`/signup`、`/onboarding` 皆不存在，`@supabase/ssr` 尚未安裝。本任務要讓使用者能註冊、登入，並讓 middleware 保護受限路由，為後續 5.3（onboarding）、5.4（requireMerchant + RLS）鋪路。

## 範圍邊界

**包含：**
- `@supabase/ssr` 安裝與 client 封裝（server + browser）
- `src/middleware.ts`：cookie 刷新 + 路由保護重導
- `/login`、`/signup` 頁面（Server Action 表單）
- `/dashboard` placeholder 頁（顯示 email + 登出按鈕）
- `env.ts` 新增 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`

**明確不含**（留給後續任務）：
- `requireMerchant` 守門邏輯 → 5.4
- RLS policies → 5.4
- onboarding 邏輯（slug 生成、建 merchant、複製範本）→ 5.3
- `/dashboard` 真實內容（待審數、分享連結）→ 5.4

## 技術路線

沿用 `@supabase/ssr` 官方樣板（唯一合理選擇——這是官方明確要求用來處理 Next.js SSR + cookie 刷新的 helper，自行處理 cookie 同步風險高且無益）。

登入/註冊表單一律用 **Server Action** 直接呼叫 Supabase Auth（而非獨立 API route）：符合 Next 16 主流做法，`@supabase/ssr` 官方樣板也是走這條路；避免額外一層 API route。

## 架構

```
src/lib/supabase/
  serverClient.ts   createServerClient()，讀寫 cookies()（Server Component/Action 用）
  browserClient.ts  createBrowserClient()（Client Component 用，備用）
src/middleware.ts   刷新 session cookie；matcher: /dashboard/**、/onboarding、/login、/signup
src/app/login/page.tsx    Server Component 表單 + Server Action
src/app/signup/page.tsx   同上
src/app/dashboard/page.tsx  placeholder（email + 登出按鈕）
```

既有 `src/lib/supabase/client.ts`（service_role 單例）不動。

## 資料流

1. `middleware.ts` 每個 request 呼叫 `supabase.auth.getUser()` 刷新 cookie。
2. 未登入訪問 `/dashboard/**`、`/onboarding` → redirect `/login`。
3. 已登入訪問 `/login`、`/signup` → redirect `/dashboard`。
4. `/login`、`/signup` 表單 submit → Server Action 呼叫 `signInWithPassword` / `signUp` → 成功 redirect `/dashboard`，失敗回傳中文錯誤訊息 inline 顯示。
5. signup 成功但 Email 未驗證（維持 Supabase 預設開啟驗證）→ 顯示「請檢查信箱完成驗證」提示，不自動登入。

## 錯誤處理

- Server Action 捕捉 Supabase Auth 錯誤（帳密錯誤、Email 已註冊、密碼強度不足）→ 轉為使用者可讀中文訊息，回傳給表單顯示，不拋 500。
- middleware 若 Supabase 呼叫失敗 → fail closed（視為未登入，導向 `/login`），不可 fail open。

## 測試

- middleware 重導邏輯：未登入訪問受保護路徑 → 檢查 redirect response；已登入訪問 `/login`/`/signup` → 檢查 redirect response。
- Server Action 直接呼叫 Supabase Auth，此階段測試以邏輯單元（重導判斷、錯誤訊息轉換）為主；實際登入流程留給 8.2 E2E（Playwright）驗收。

## 風險

Supabase Auth cookie/SSR 在 Next 16 的整合細節（WBS 風險清單第一條）——嚴格照 `@supabase/ssr` 官方樣板，先求最小可跑（signup → login → middleware 重導），不一次擴太多。
