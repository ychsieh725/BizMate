# 案例研究：後台導覽「點了要等 2 秒」的根因與修復

> **對應 commit**：`6bad440` `02ca6a9` `32ce0a4`（`--no-ff` 併入 `3159fbb`）
> **日期**：2026-07-19
> **一句話**：使用者已把 Vercel region 對齊 Supabase region 仍體感慢，
> 根因不在跨區延遲，而是每次導覽被迫做 **5 次序列後端往返**，
> 且全站沒有任何 loading 邊界，畫面在整條鏈跑完前完全靜止。

---

## 1. 摘要

| 項目 | 修復前 | 修復後 |
| :--- | :--- | :--- |
| 每次後台導覽的序列後端往返 | 5 次 | 2 次 |
| middleware 對 Supabase 的網路呼叫 | 2 次（驗證 token + 查 merchant） | 0 次（token 本地驗證，多數路徑免查 merchant） |
| 點擊到畫面第一次回應 | 無 loading 邊界，靜止到整頁渲染完成 | 立即切換為骨架 |
| 單一 PostgREST 查詢實測延遲（本機→Supabase） | 中位數 242ms | 同（跨區成本無法消除，見第 6 節） |
| 單一 Auth `/user` 端點實測延遲 | 中位數 211ms | 該呼叫已移除（本地驗證） |

---

## 2. 問題陳述

使用者回報：後台每點一個按鈕（導覽切換、儲存、確認）都要等約 2 秒才有反應，
即便先前已將 Vercel 部署 region 對齊 Supabase region，仍有微幅改善但體感依舊慢。

**這句話本身排除了一個常見誤判**：如果只是跨區延遲，對齊 region 應該解決大半問題，
但使用者反映「仍然慢」——代表延遲的主要來源不是網路距離，而是**呼叫次數**或
**呈現方式**。這是本次調查的起點，而非直接猜測「加 cache」或「換 CDN」。

---

## 3. 根因調查

### 3.1 先量測，不猜測

寫一支一次性腳本（`measure-latency.mjs`），直接對專案的 Supabase 打三種請求，
量測單次往返的量級：

```
PostgREST select merchants limit 1: median=242ms  min=216ms  max=855ms
Auth /user endpoint:                median=211ms  min=210ms  max=393ms
JWKS keys: EC/ES256（支援本地驗證）
```

兩個關鍵發現：

1. **每次往返約 200-250ms**，跨區成本確實存在，但單次並不到「2 秒」的量級——
   代表 2 秒是**多次往返疊加**的結果，不是單次呼叫特別慢。
2. **JWKS 回傳的是 EC/ES256（非對稱簽章）**，這代表 Supabase JWT 驗證
   *理論上*可以在本地用 WebCrypto 完成、不必每次都打 Auth server。
   這是後續 middleware 優化的關鍵前提，若專案仍用舊式 HS256 對稱簽章，
   這個優化選項就不成立。

### 3.2 追蹤請求生命週期，數往返次數

沿路徑讀完 `src/proxy.ts` → `middlewareClient.ts` → `requireMerchant.ts` →
`dashboard/layout.tsx` → `dashboard/page.tsx`，把每一次對 Supabase 的呼叫標出來：

```
使用者點擊「總覽」導覽
  │
  ├─ ① middleware: supabase.auth.getUser()          ← 網路往返（驗證 token）
  ├─ ② middleware: merchantsRepository.findById()    ← 網路往返（查 merchant 決定要不要導向 onboarding）
  │     ↓ 通過，放行到 RSC
  ├─ ③ layout.tsx:  requireMerchant()
  │       └─ supabase.auth.getUser()                 ← 網路往返（再次驗證，同一個 token）
  │       └─ merchantsRepository.findById()           ← 網路往返（再次查同一筆 merchant）
  ├─ ④ layout.tsx:  merchantsRepository.findById()    ← 網路往返（第三次查同一筆，只為了 display_name）
  └─ ⑤ page.tsx:    quotesRepository.countByStatus()  ← 網路往返（唯一「必要」的查詢）
```

**同一筆 `merchants` 資料在一次導覽裡被查了三次**（②④重複③內部已查過的），
**同一個 token 被驗證了兩次**（①③）。這些呼叫彼此依賴前一步結果，
無法平行化，是**純粹疊加**：5 × ~220ms ≈ 1.1 秒，加上 Vercel serverless
function 冷啟動與 RSC 渲染本身的時間，符合使用者回報的「約 2 秒」。

**同時發現第二個問題**：檢查整個 `src/app` 目錄，沒有任何 `loading.tsx`。
Next.js App Router 若無 loading 邊界，點擊連結後瀏覽器畫面在「上述整條鏈
完全跑完」前不會有任何變化——即使把往返次數砍到最低，使用者能感知到的
延遲仍然等於「伺服器算完整頁的時間」，而非「網路實際花費的時間」。

### 3.3 定位可消除的往返

把 5 次往返分兩類：

| 往返 | 可否消除 | 理由 |
| :--- | :--- | :--- |
| ① middleware 驗 token | ✅ 可消除為本地驗證 | JWKS 確認為非對稱簽章，`getClaims()` 可用 WebCrypto 本地完成 |
| ② middleware 查 merchant | ✅ 多數路徑可消除 | 只有 `/login`、`/signup`、`/onboarding` 需要這個查詢結果來決定重導方向；`/dashboard` 路徑本身不需要——「無 merchant」的情況本來就會被下一步的 layout 攔截 |
| ③ layout 驗 token + 查 merchant | ⚠️ 保留 | 這是租戶隔離的主要守門（`requireMerchant`），middleware 只做 UX 重導，兩者職責不同，不可合併省略 |
| ④ layout 重查 merchant | ✅ 可消除 | ③ 已經查過同一筆資料，只是沒把結果傳出來 |
| ⑤ page 查報價數量 | ❌ 不可消除 | 每頁各自需要的業務資料，本就該查 |

---

## 4. 解法評估

### 4.1 middleware：`getUser()` → `getClaims()`

| 方案 | 判斷 | 理由 |
| :--- | :--- | :--- |
| **`getClaims()`（本地驗證）** | ✅ 採用 | JWKS 確認 ES256 非對稱簽章，驗證走 WebCrypto，JWKS 快取於 function 實例，正常路徑零網路往返 |
| 維持 `getUser()` 但加 cache | ❌ 否決 | middleware 是 edge/serverless 環境，跨請求快取不可靠（每個 function 實例可能是新的），且 token 本身會變化，快取價值有限 |
| 完全移除 middleware 驗證，全交給 layout | ❌ 否決 | middleware 的重導職責（未登入導向 `/login`）若拿掉，未登入使用者會先看到 RSC 渲染的殘影再被導轉，體驗更差 |

**安全邊界確認**：改用 `getClaims()` 後，middleware 只做 UX 層級的重導判斷，
**不是**租戶隔離的主要防線——那是 `requireMerchant`（伺服器端 `getUser()`，
可即時感知 token 撤銷）加上 RLS policy 的第二道防線。這個邊界在改動前後沒有變化，
只是把「middleware 這一層」的驗證方式從遠端換成本地。

### 4.2 middleware：`/dashboard` 路徑免查 merchant

抽出純函式 `needsMerchantLookup(pathname)`，只有 `/login`、`/signup`、
`/onboarding` 回傳 `true`。`/dashboard` 路徑的 `hasMerchant` 直接預設 `true`
放行，真正「登入但無 merchant」的情況由 `dashboard/layout.tsx` 呼叫
`requireMerchant()` 拿到 403 後 `redirect("/onboarding")` 兜底。

**行為等價性**：使用者感知到的結果完全相同（無 merchant 者最終都會落在
`/onboarding`），差別只在「由誰執行這次重導」——從 middleware 移到 layout，
省下的是**高頻路徑**（`/dashboard/*`，也就是使用者最常點的地方）的一次查詢，
低頻路徑（登入、註冊那幾次）維持原樣不受影響。

### 4.3 `requireMerchant` 一併回傳 merchant 本體

`requireMerchant()` 內部本來就會 `merchantsRepository.findById()` 一次，
只是回傳值只留 `merchantId`，呼叫端（layout 要 `display_name`、總覽頁要
`public_slug`）又各自重查一次同一筆資料。改法很直接：把已經查到的
`merchant` 物件放進回傳型別：

```ts
export type RequireMerchantResult =
  | { ok: true; merchantId: string; merchant: Tables<"merchants"> }
  | { ok: false; status: 401 | 403 };
```

這是加欄位、非破壞性變更，既有只解構 `merchantId` 的 API route 不受影響。

---

## 5. 實作與驗證

### 5.1 變更清單

| 檔案 | 變更 |
| :--- | :--- |
| `src/app/dashboard/loading.tsx` | **新增**。共用載入骨架，Suspense 邊界 |
| `src/lib/supabase/middlewareClient.ts` | `getUserAndResponse` → `getUserIdAndResponse`，改用 `getClaims()` |
| `src/lib/auth/redirectDecision.ts` | 新增 `needsMerchantLookup` 純函式 |
| `src/proxy.ts` | 依 `needsMerchantLookup` 決定是否查 merchant |
| `src/lib/auth/requireMerchant.ts` | 回傳型別新增 `merchant` 欄位 |
| `src/app/dashboard/layout.tsx` | 401/403 皆改為 `redirect()`；改用 `auth.merchant` |
| `src/app/dashboard/page.tsx`、`settings/page.tsx` | 改用 `auth.merchant`，刪除重複查詢 |
| `src/lib/auth/requireMerchantFixtures.ts` | **新增**。測試共用 fixture（7 個 API route 測試檔重複的 mock 集中一處） |

### 5.2 TDD 流程

依專案 `testing.md` 規範，每項變更先寫測試見紅，再實作至綠：

```
RED（改測試，跑）→ 型別/邏輯不存在 → 全部失敗
  needsMerchantLookup is not a function
  getUserIdAndResponse is not a function
  AssertionError: expected merchantId only, got merchant field missing

GREEN（實作後）
  Test Files  51 passed (51)
       Tests  483 passed (483)
```

### 5.3 冒煙測試

`next build` 通過後，`next start` 起本地正式模式伺服器驗證重導邏輯：

```
未登入訪問 /dashboard → 307 → /login   ✓
/login                → 200            ✓
/（公開首頁）          → 200            ✓
```

---

## 6. 效果與誠實的限制

### 6.1 這次改動解決了什麼

- **序列後端往返 5 → 2 次**：middleware 驗證與查詢從網路呼叫變成本地/省略，
  layout 與頁面不再重查同一筆 merchant。
- **點擊到有回饋的時間**：從「等整條鏈跑完」變成「立即」——loading.tsx
  補上後，使用者點擊的瞬間畫面就會變化，即使伺服器仍在算資料。

### 6.2 這次改動沒有解決、也解決不了的部分

- **跨洋 RTT 本身**：使用者的 Supabase 專案 region 與最終使用者的實體距離，
  這是物理限制，region 對齊只能讓「Vercel ↔ Supabase」這段變快，
  「使用者瀏覽器 ↔ Vercel edge」這段不受影響。
- **Vercel Hobby 免費層的 serverless 冷啟動**：閒置一段時間後第一次請求
  會有額外的啟動延遲，這與程式碼邏輯無關。
- **根治跨區延遲需要把 Supabase 專案換到離終端使用者更近的 region**，
  但受免費層「2 個專案上限」限制（另一名額是使用者的作品集網站），
  目前策略是沿用現有專案、不新建，這個取捨在部署決策中已記錄
  （見 `docs/deployment.md`），本次不重新評估。

換句話說：**這次修的是「不必要的等待」，不是「網路本身的速度」。**
兩者疊加起來，使用者應該會感覺到明顯改善，但不會變成「瞬間」——
剩下的延遲來自無法在應用層消除的基礎設施限制。
