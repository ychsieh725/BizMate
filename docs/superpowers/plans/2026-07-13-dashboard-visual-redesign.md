# 後台視覺重新設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or the Execute Plan phase of superpowers:sunnydata-design to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/dashboard/**` 五個頁面從 Next.js 預設樣板外觀，改成柔霧漸層底 + 漂浮圓角卡片的設計語言，不改動任何業務邏輯。

**Architecture:** 新增 `dashboard/layout.tsx` 統一導覽與 auth 守門（`requireMerchant()` 包 `cache()` 做 per-request 去重）；`globals.css` 新增設計 tokens；五個 page.tsx 移除重複的導覽/錯誤 UI 並套用新視覺；新增 `StatusPill` 共用元件。

**Tech Stack:** Next.js 16 App Router / Tailwind CSS v4 / React `cache()` / lucide-react（新增）

---

## 前置依據

- 對應 spec：[`docs/superpowers/specs/2026-07-13-dashboard-visual-redesign-design.md`](../specs/2026-07-13-dashboard-visual-redesign-design.md)
- 已於規劃階段實測驗證：React `cache()` 在非 render context（如 Vitest 直接呼叫）下**不會**跨呼叫記憶——`src/lib/auth/requireMerchant.test.ts` 的四個 `it()` 各自用不同 mock 呼叫 `requireMerchant()`，包 `cache()` 後不會互相污染（已用一次性實驗腳本驗證：兩個獨立 `it()` 呼叫同一個 `cache()` 包裝的函式，各自吃到新鮮結果而非快取值）。
- 分支：`chore/ui-redesign-dashboard`（已存在，已 rebase 上最新 main）

---

### Task 1: 設計 Tokens — `globals.css`

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 加入色彩 tokens 與共用 class**

在 `:root` 區塊既有的 `--background`/`--foreground` 後面加入，並在 `@theme inline` 對應加 `--color-*` 映射，檔案最終內容：

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;

  --ink: #1a1a18;
  --ink-soft: #6b6b64;
  --ink-faint: #8a897f;
  --surface: #fbfaf7;
  --surface-line: #e2e2dd;
  --rail-bg: rgba(255, 255, 255, 0.72);
  --accent: #e2664a;
  --accent-ink: #1b1a20;
  --status-review-bg: #fbead0;
  --status-review-fg: #9a6300;
  --status-confirmed-bg: #dfe9ff;
  --status-confirmed-fg: #2c4fb0;
  --status-sent-bg: #dcf0e6;
  --status-sent-fg: #16794f;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-ink-faint: var(--ink-faint);
  --color-surface: var(--surface);
  --color-surface-line: var(--surface-line);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-status-review-bg: var(--status-review-bg);
  --color-status-review-fg: var(--status-review-fg);
  --color-status-confirmed-bg: var(--status-confirmed-bg);
  --color-status-confirmed-fg: var(--status-confirmed-fg);
  --color-status-sent-bg: var(--status-sent-bg);
  --color-status-sent-fg: var(--status-sent-fg);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: Arial, Helvetica, sans-serif;
}

.aura-bg {
  background:
    radial-gradient(ellipse 620px 480px at 6% -6%, rgba(246, 208, 164, 0.85), transparent 60%),
    radial-gradient(ellipse 520px 420px at 34% 6%, rgba(247, 196, 196, 0.55), transparent 60%),
    radial-gradient(ellipse 640px 560px at 100% 96%, rgba(196, 209, 244, 0.85), transparent 62%),
    radial-gradient(ellipse 460px 380px at 78% 60%, rgba(222, 231, 248, 0.55), transparent 65%),
    #f7f4ee;
}

.card-float {
  box-shadow:
    0 20px 46px -26px rgba(35, 26, 15, 0.28),
    0 2px 10px rgba(35, 26, 15, 0.05);
}
```

（不動既有的 `@media (prefers-color-scheme: dark)` 與 `body` 規則——spec D 已明訂此次不做深色模式。）

- [ ] **Step 2: 驗證**

```bash
pnpm build
```

Expected: 建置成功，無 CSS 語法錯誤。這一步沒有邏輯可測，用建置成功作為驗證。

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style(dashboard): 新增柔霧漸層與卡片設計 tokens"
```

---

### Task 2: 補 `PAGE_ROUTES.dashboardServices`

現況 `dashboard/page.tsx` 用字面字串 `"/dashboard/services"`（未走 `PAGE_ROUTES`），layout 的導覽列需要一致引用四個路徑，順手補上這個既有缺口。

**Files:**
- Modify: `src/shared/constants/routes.ts`

- [ ] **Step 1: 加入常數**

```ts
export const PAGE_ROUTES = {
  home: "/",
  quoteWizard: (slug: string) => `/q/${slug}`,
  login: "/login",
  signup: "/signup",
  onboarding: "/onboarding",
  dashboard: "/dashboard",
  dashboardQuotes: "/dashboard/quotes",
  dashboardQuote: (id: string) => `/dashboard/quotes/${id}`,
  dashboardServices: "/dashboard/services",
  dashboardSettings: "/dashboard/settings",
} as const;
```

（只新增 `dashboardServices` 一行，其餘不動。）

- [ ] **Step 2: 驗證**

```bash
pnpm build
```

Expected: 型別檢查通過（此常數尚未被使用，不影響既有程式碼）。

- [ ] **Step 3: Commit**

```bash
git add src/shared/constants/routes.ts
git commit -m "chore(routes): 補 dashboardServices 常數，消除硬編碼路徑"
```

---

### Task 3: `requireMerchant()` 包 `cache()`

**Files:**
- Modify: `src/lib/auth/requireMerchant.ts`

- [ ] **Step 1: 執行既有測試，確認目前綠燈（作為改動前基準）**

```bash
pnpm test -- requireMerchant
```

Expected: 4 個測試全過。

- [ ] **Step 2: 加上 `cache()` 包裝**

```ts
import { cache } from "react";
import { createClient } from "@/lib/supabase/serverClient.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";

export type RequireMerchantResult =
  | { ok: true; merchantId: string }
  | { ok: false; status: 401 | 403 };

/**
 * dashboard API 第一行呼叫的守門工具：cookie → auth.uid() → merchant 查詢。
 * 這是租戶隔離的主要保證（RLS policy 是第二道防線，見 5.4 spec）。
 * Supabase 呼叫例外一律 fail closed（401），不可 fail open。
 *
 * 包 cache()：dashboard/layout.tsx 與同層 page.tsx 都要呼叫本函式，
 * React 官方的 per-request memoization 模式讓同一次請求內的第二次呼叫
 * 直接吃快取、不重複打 Supabase。cache() 只在 React render context 內
 * 生效，Vitest 直接呼叫（無 render context）不受影響——已實測驗證。
 */
export const requireMerchant = cache(
  async (): Promise<RequireMerchantResult> => {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user === null) {
        return { ok: false, status: 401 };
      }

      const merchant = await merchantsRepository.findById(user.id);
      if (merchant === null) {
        return { ok: false, status: 403 };
      }

      return { ok: true, merchantId: user.id };
    } catch {
      return { ok: false, status: 401 };
    }
  },
);
```

- [ ] **Step 3: 重跑測試確認仍綠**

```bash
pnpm test -- requireMerchant
pnpm test
```

Expected: `requireMerchant.test.ts` 4 個測試仍全過；全專案 397 個測試仍全過（`cache()` 不改變函式的輸入輸出行為，只加記憶化）。

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/requireMerchant.ts
git commit -m "perf(auth): requireMerchant 包 React cache() 做 per-request 去重

WHY
dashboard/layout.tsx 即將統一呼叫 requireMerchant() 處理錯誤畫面，
但各 page.tsx 仍需各自呼叫一次取得 merchantId（layout 無法把資料
當 props 傳給 page，這是 Next.js App Router 的既有限制）。不包快取
的話，同一次請求會變成打兩次 Supabase。

WHAT
用 React 官方的 cache() 做 per-request memoization。已實測確認
cache() 在非 render context（如本檔的 Vitest 測試）下不記憶，
故不影響既有 4 個單元測試的獨立性。

IMPACT
純效能優化，回傳值與錯誤處理行為完全不變。"
```

---

### Task 4: 新增 `lucide-react` 依賴

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: 安裝**

```bash
pnpm add lucide-react
```

- [ ] **Step 2: 驗證無已知漏洞**

```bash
pnpm audit
```

Expected: 無新增漏洞（若有，記錄下來但不阻塞——lucide-react 是零執行期依賴的純圖示庫，攻擊面極小）。

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): 新增 lucide-react 取代重複手刻 SVG 圖示"
```

---

### Task 5: `StatusPill` 共用元件

沿用專案「純函式邏輯獨立可測、JSX 元件不寫渲染測試」的既有慣例（全專案零 `.test.tsx`，所有 `.test.ts` 測的都是邏輯而非渲染輸出）——把「狀態 → class」的對照抽成可測的純函式，元件本身只是薄薄一層消費它。

**Files:**
- Create: `src/app/dashboard/StatusPill.tsx`
- Test: `src/app/dashboard/StatusPill.test.ts`

- [ ] **Step 1: 寫會失敗的測試**

```ts
import { describe, it, expect } from "vitest";
import { statusPillClassName } from "./StatusPill.tsx";

describe("statusPillClassName", () => {
  it("draft 回灰底樣式", () => {
    expect(statusPillClassName("draft")).toContain("bg-surface-line");
  });

  it("awaiting_review 回黃底樣式", () => {
    expect(statusPillClassName("awaiting_review")).toContain("bg-status-review-bg");
  });

  it("confirmed 回藍底樣式", () => {
    expect(statusPillClassName("confirmed")).toContain("bg-status-confirmed-bg");
  });

  it("sent 回綠底樣式", () => {
    expect(statusPillClassName("sent")).toContain("bg-status-sent-bg");
  });
});
```

- [ ] **Step 2: 執行確認失敗**

```bash
pnpm test -- StatusPill
```

Expected: FAIL，`Cannot find module './StatusPill.tsx'` 或找不到 `statusPillClassName`。

- [ ] **Step 3: 寫最小實作**

```tsx
import type { QuoteStatus } from "@/shared/types/domain.types";

const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: "bg-surface-line text-ink-soft",
  awaiting_review: "bg-status-review-bg text-status-review-fg",
  confirmed: "bg-status-confirmed-bg text-status-confirmed-fg",
  sent: "bg-status-sent-bg text-status-sent-fg",
};

/** 狀態 → Tailwind class 的對照，抽成純函式以利獨立測試。 */
export function statusPillClassName(status: QuoteStatus): string {
  return `rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLE[status]}`;
}

export function StatusPill({
  status,
  label,
}: {
  status: QuoteStatus;
  label: string;
}) {
  return <span className={statusPillClassName(status)}>{label}</span>;
}
```

- [ ] **Step 4: 執行確認通過**

```bash
pnpm test -- StatusPill
```

Expected: 4 個測試全過。

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/StatusPill.tsx src/app/dashboard/StatusPill.test.ts
git commit -m "feat(dashboard): 新增 StatusPill 共用元件（狀態→樣式對照抽成可測純函式）"
```

---

### Task 6: `dashboard/layout.tsx`（懸浮側欄 + auth 守門）

**Files:**
- Create: `src/app/dashboard/layout.tsx`

- [ ] **Step 1: 寫檔案**

```tsx
import Link from "next/link";
import { LayoutGrid, FileText, Tag, Settings, LogOut } from "lucide-react";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { logoutAction } from "./actions.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { RailNavLink } from "./RailNavLink.tsx";

const NAV_ITEMS = [
  { href: PAGE_ROUTES.dashboard, label: "總覽", icon: LayoutGrid },
  { href: PAGE_ROUTES.dashboardQuotes, label: "報價", icon: FileText },
  { href: PAGE_ROUTES.dashboardServices, label: "服務", icon: Tag },
  { href: PAGE_ROUTES.dashboardSettings, label: "設定", icon: Settings },
] as const;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireMerchant();

  if (!auth.ok) {
    return (
      <div className="aura-bg flex min-h-screen flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-red-600">
          {auth.status === 401 ? "請先登入" : "查無商家資料，請先完成 onboarding"}
        </p>
      </div>
    );
  }

  const merchant = await merchantsRepository.findById(auth.merchantId);
  const initial = merchant?.display_name?.charAt(0) ?? "商";

  return (
    <div className="aura-bg flex min-h-screen flex-1 gap-4 p-4">
      <nav
        aria-label="後台導覽"
        className="card-float bg-rail-bg flex w-16 flex-none flex-col items-center gap-2 rounded-[26px] py-4 backdrop-blur-lg"
      >
        <div className="bg-ink text-surface mb-2 flex h-9 w-9 items-center justify-center rounded-[11px] font-mono text-sm font-medium">
          BM
        </div>

        {NAV_ITEMS.map((item) => (
          <RailNavLink key={item.href} href={item.href} label={item.label}>
            <item.icon className="h-[15px] w-[15px]" strokeWidth={1.6} />
          </RailNavLink>
        ))}

        <div className="flex-1" />

        <form action={logoutAction}>
          <button
            type="submit"
            aria-label="登出"
            className="text-ink-soft flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5"
          >
            <LogOut className="h-[15px] w-[15px]" strokeWidth={1.6} />
          </button>
        </form>

        <div
          className="bg-accent mt-1 flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
          title={merchant?.display_name ?? undefined}
        >
          {initial}
        </div>
      </nav>

      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: 建立 `RailNavLink`（需要 client component 判斷 active pathname，獨立成小檔避免整個 layout 變成 `"use client"`）**

**Files:**
- Create: `src/app/dashboard/RailNavLink.tsx`

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function RailNavLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        active ? "bg-ink text-surface" : "text-ink-soft hover:bg-black/5"
      }`}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 3: 驗證**

```bash
pnpm build
pnpm lint
```

Expected: 建置與 lint 皆通過。這兩個檔案沒有可獨立單元測試的邏輯分支（`active` 的字串比對太簡單、且是 client component 依賴 `usePathname()`，依專案慣例不寫渲染測試），驗證交給下一個 Task 的 E2E 回歸。

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/layout.tsx src/app/dashboard/RailNavLink.tsx
git commit -m "feat(dashboard): 新增共用 layout（懸浮側欄導覽 + 統一 auth 守門）

WHY
五個 dashboard 頁面各自重複 requireMerchant() 呼叫、重複的 401/403
錯誤畫面 JSX、重複的導覽連結。新增共用 layout 統一處理，讓各頁面
只保留自己的內容。

WHAT
- 懸浮側欄：logo、四個導覽圖示（RailNavLink 用 usePathname 判斷
  active 態）、登出、商家大頭貼
- auth 守門：未登入/無商家時直接短路回傳錯誤畫面，不渲染 children
- 最外層套 .aura-bg 漸層底，所有子頁面共享同一片背景

IMPACT
下個 task 會移除各 page.tsx 裡重複的 401/403 判斷與導覽連結。"
```

---

### Task 7: 移除五個頁面重複的 401/403 區塊與導覽連結

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/quotes/page.tsx`
- Modify: `src/app/dashboard/quotes/[id]/page.tsx`
- Modify: `src/app/dashboard/services/page.tsx`
- Modify: `src/app/dashboard/settings/page.tsx`

這個 task 只做「刪除重複邏輯」，不做視覺改版（視覺改版是 Task 8-12）。每個檔案的改動都是同一個模式：刪掉 `if (!auth.ok) return (...)` 區塊（layout 已攔截，這裡永遠不會是 false，但 TypeScript 仍需要這個型別窄化才能安全存取 `auth.merchantId`——所以**保留 `if (!auth.ok)` 判斷式本身，只刪掉裡面的 JSX**，改成 `notFound()` 或直接留空判斷都不對；正確做法是保留判斷但簡化回傳，見下）。

- [ ] **Step 1: `dashboard/page.tsx` — 只刪導覽連結，401/403 判斷留待 Task 8 一併改版**

（本 task 先不動這個檔案的錯誤處理，因為 Task 8 會整個重寫這個檔案的 JSX。避免同一個檔案兩個 task 都改導致 diff 難 review，`dashboard/page.tsx` 的清理併入 Task 8。）

- [ ] **Step 2: `quotes/page.tsx` — 移除 401/403 JSX，保留型別窄化**

找到：

```tsx
  const auth = await requireMerchant();

  if (!auth.ok) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-red-600">
          {auth.status === 401 ? "請先登入" : "查無商家資料，請先完成 onboarding"}
        </p>
      </main>
    );
  }
```

改成：

```tsx
  const auth = await requireMerchant();
  // layout 已攔截未登入/無商家的情況（不會渲染到這裡）；
  // 這裡的 if 只是讓 TypeScript 把 auth 窄化成 { ok: true, merchantId } 型別。
  if (!auth.ok) {
    return null;
  }
```

同時移除頂部「返回 Dashboard」的 `<Link>`（layout 側欄已有總覽入口）：

```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">報價管理</h1>
        <Link href={PAGE_ROUTES.dashboard} className="text-sm underline">
          返回 Dashboard
        </Link>
      </div>
```

改成：

```tsx
      <h1 className="text-2xl font-semibold">報價管理</h1>
```

並移除現在沒用到的 `Link` import（若 `PAGE_ROUTES.dashboard` 沒被其他地方用到也一併清掉未用的 import，跑 lint 會抓到）。

- [ ] **Step 3: 對 `quotes/[id]/page.tsx`、`services/page.tsx`、`settings/page.tsx` 套用同樣的兩個修改（401/403 → `if (!auth.ok) return null;`、移除「返回 Dashboard」連結與未用 import）**

三個檔案的修改模式與 Step 2 完全相同，逐檔套用。

- [ ] **Step 4: 驗證**

```bash
pnpm lint    # 抓未用的 import
pnpm test    # 確認 397 個測試仍全過（這些檔案沒有對應的 .test.ts 直接測 JSX 輸出）
pnpm build   # TypeScript 型別檢查——確認 auth.merchantId 在 if 判斷後仍能正確存取
```

Expected: 全部通過。

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/quotes/page.tsx src/app/dashboard/quotes/\[id\]/page.tsx src/app/dashboard/services/page.tsx src/app/dashboard/settings/page.tsx
git commit -m "refactor(dashboard): 移除四個頁面重複的 401/403 畫面與導覽連結

WHY
Task 6 的 layout 已統一攔截未登入/無商家的情況並提供導覽，四個頁面
裡原本各自的錯誤畫面 JSX 與「返回 Dashboard」連結變成死碼。

WHAT
if (!auth.ok) 判斷式保留（TypeScript 型別窄化需要），回傳值從完整
錯誤畫面簡化為 return null（實務上不會走到，layout 已擋在前面）。

IMPACT
純刪除重複程式碼，不改變任何使用者可見行為（因為這些分支已經
不可能被 layout 放行後觸發）。"
```

---

### Task 8: 改版 `/dashboard`（總覽）

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: 整檔改寫**

```tsx
import Link from "next/link";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { CopyLinkButton } from "./CopyLinkButton.tsx";

export default async function DashboardPage() {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return null;
  }

  const [merchant, pendingCount] = await Promise.all([
    merchantsRepository.findById(auth.merchantId),
    quotesRepository.countByStatus(auth.merchantId, "awaiting_review"),
  ]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">總覽</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href={`${PAGE_ROUTES.dashboardQuotes}?status=awaiting_review`}
          className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-6 transition-transform hover:-translate-y-0.5"
        >
          <span className="text-ink-soft text-xs font-medium tracking-wide uppercase">
            待審報價
          </span>
          <span className="text-ink font-mono text-3xl font-semibold tabular-nums">
            {pendingCount}
          </span>
        </Link>

        <div className="card-float flex flex-col gap-3 rounded-[24px] bg-[var(--surface)] p-6">
          <span className="text-ink-soft text-xs font-medium tracking-wide uppercase">
            分享連結
          </span>
          {merchant !== null && (
            <>
              <p className="text-ink-soft text-sm">
                把這個連結傳給客戶，他們的需求會出現在待審報價裡。
              </p>
              <CopyLinkButton slug={merchant.public_slug} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 驗證**

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: 全過。`CopyLinkButton.tsx` 本身完全不動，只是換了外層容器。

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "style(dashboard): 總覽頁改版為並排統計卡 + 分享連結卡"
```

---

### Task 9: 改版 `/dashboard/quotes`（列表）

**Files:**
- Modify: `src/app/dashboard/quotes/page.tsx`

- [ ] **Step 1: 整檔改寫**

```tsx
import Link from "next/link";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { listQuotesQuerySchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { StatusPill } from "../StatusPill.tsx";
import { formatAmount, formatDateTime } from "./formatters.ts";

const ALL_TAB = { label: "全部", href: PAGE_ROUTES.dashboardQuotes } as const;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return null;
  }

  const { status: statusParam } = await searchParams;
  const parsed = listQuotesQuerySchema.safeParse(
    statusParam === undefined ? {} : { status: statusParam },
  );
  const activeStatus = parsed.success ? parsed.data.status : undefined;
  const items = await listQuotes(auth.merchantId, activeStatus);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">報價管理</h1>

      <nav aria-label="狀態篩選" className="flex flex-wrap gap-2 text-sm">
        <Link
          href={ALL_TAB.href}
          aria-current={activeStatus === undefined ? "page" : undefined}
          className="text-ink-soft rounded-full border border-[var(--surface-line)] px-3 py-1.5 aria-[current=page]:border-[var(--ink)] aria-[current=page]:bg-[var(--ink)] aria-[current=page]:text-[var(--surface)]"
        >
          {ALL_TAB.label}
        </Link>
        {QUOTE_STATUSES.map((status) => (
          <Link
            key={status}
            href={`${PAGE_ROUTES.dashboardQuotes}?status=${status}`}
            aria-current={activeStatus === status ? "page" : undefined}
            className="text-ink-soft rounded-full border border-[var(--surface-line)] px-3 py-1.5 aria-[current=page]:border-[var(--ink)] aria-[current=page]:bg-[var(--ink)] aria-[current=page]:text-[var(--surface)]"
          >
            {QUOTE_STATUS_LABELS[status]}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="card-float text-ink-soft rounded-[24px] bg-[var(--surface)] p-6 text-sm">
          尚無報價。把你的專屬連結傳給客戶，他們送出的需求會出現在這裡。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={PAGE_ROUTES.dashboardQuote(item.id)}
              className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-4 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-center gap-3">
                <span className="bg-accent flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold text-white">
                  {item.category === null ? "?" : CASE_CATEGORY_LABELS[item.category].charAt(0)}
                </span>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="text-ink font-mono text-sm font-semibold">
                    {item.quote_code}
                  </span>
                  <span className="text-ink-faint text-xs">
                    {formatDateTime(item.created_at)}
                  </span>
                </div>
              </div>

              <p className="text-ink-soft truncate text-sm">
                {item.contact_email ?? "—"}
              </p>

              <div className="flex items-center gap-2">
                <StatusPill status={item.status} label={QUOTE_STATUS_LABELS[item.status]} />
                {item.is_conservative && (
                  <span className="bg-status-review-bg text-status-review-fg rounded-full px-2.5 py-1 text-[11px] font-medium">
                    保守估算
                  </span>
                )}
                <span className="text-ink ml-auto font-mono text-sm font-medium tabular-nums">
                  {formatAmount(item.final_amount)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 驗證**

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: 全過。`?status=` URL query 邏輯、`listQuotesQuerySchema` 驗證完全不動。

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/quotes/page.tsx
git commit -m "style(dashboard): 報價列表改版為漂浮卡片列表，狀態篩選改膠囊按鈕"
```

---

### Task 10: 改版 `/dashboard/quotes/[id]`（詳情）

**Files:**
- Modify: `src/app/dashboard/quotes/[id]/page.tsx`
- Modify: `src/app/dashboard/quotes/[id]/QuoteActions.tsx`（僅按鈕 class）
- Modify: `src/app/dashboard/quotes/[id]/SendQuoteButton.tsx`（僅按鈕 class）

- [ ] **Step 1: 改版 `page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { fieldLabel } from "@/shared/constants/fieldLabels.ts";
import { formatAmount, formatDateTime } from "../formatters.ts";
import { StatusPill } from "../../StatusPill.tsx";
import { QuoteActions } from "./QuoteActions.tsx";
import { SendQuoteButton } from "./SendQuoteButton.tsx";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return null;
  }

  const { id } = await params;
  const idParsed = quoteIdSchema.safeParse(id);
  if (!idParsed.success) {
    notFound();
  }

  const detail = await getQuoteDetail(idParsed.data, auth.merchantId);
  if (detail === null) {
    notFound();
  }

  const { quote, session, lineItems, extractedFields, clarifications, rawInputs } =
    detail;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <span className="bg-accent flex h-12 w-12 flex-none items-center justify-center rounded-full text-base font-bold text-white">
          {CASE_CATEGORY_LABELS[session.category].charAt(0)}
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-ink font-mono text-lg font-semibold">
            {quote.quote_code}
          </span>
          <span className="text-ink-soft text-sm">{session.contact_email ?? "—"}</span>
        </div>
      </div>

      <section className="card-float flex flex-col gap-4 rounded-[24px] bg-[var(--surface)] p-6">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-ink-soft">分類</dt>
          <dd className="text-ink">{CASE_CATEGORY_LABELS[session.category]}</dd>
          <dt className="text-ink-soft">狀態</dt>
          <dd>
            <StatusPill status={quote.status} label={QUOTE_STATUS_LABELS[quote.status]} />
          </dd>
          <dt className="text-ink-soft">建立時間</dt>
          <dd className="text-ink">{formatDateTime(quote.created_at)}</dd>
        </dl>

        <div className="bg-accent-ink text-surface flex items-center justify-between rounded-[16px] px-5 py-4">
          <span className="text-sm text-white/70">最終金額</span>
          <span className="font-mono text-xl font-medium tabular-nums">
            {formatAmount(quote.final_amount)}
          </span>
        </div>
        {quote.is_conservative && (
          <p className="bg-status-review-bg text-status-review-fg rounded-[10px] px-3 py-2 text-xs">
            保守估算（資訊不足，客戶未完成反問）
          </p>
        )}
      </section>

      {quote.status === "awaiting_review" && (
        <QuoteActions quoteId={quote.id} initialAmount={quote.final_amount} />
      )}
      {quote.status === "confirmed" && <SendQuoteButton quoteId={quote.id} />}

      <section className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-6">
        <h2 className="text-ink text-sm font-semibold">費用明細</h2>
        {lineItems.length === 0 ? (
          <p className="text-ink-soft text-sm">無費用明細</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">費用明細</caption>
            <thead>
              <tr className="border-b border-[var(--surface-line)] text-left">
                <th className="text-ink-soft py-2 font-normal">項目</th>
                <th className="text-ink-soft py-2 font-normal">金額</th>
                <th className="text-ink-soft py-2 font-normal">計價依據</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id} className="border-b border-[var(--surface-line)] align-top">
                  <td className="text-ink py-2">{item.item_name}</td>
                  <td className="text-ink py-2 font-mono tabular-nums">
                    {formatAmount(item.amount)}
                  </td>
                  <td className="text-ink-soft py-2">
                    {item.agent_reasoning ?? "固定費率查表"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 追溯依據：降階處理，視覺份量明顯低於上面的核心資訊 */}
      <section className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-5 text-xs">
        <h2 className="text-ink-soft font-medium">抽取欄位</h2>
        {extractedFields.length === 0 ? (
          <p className="text-ink-faint">無抽取欄位</p>
        ) : (
          <table className="w-full border-collapse">
            <caption className="sr-only">從客戶描述抽取的欄位</caption>
            <thead>
              <tr className="border-b border-[var(--surface-line)] text-left">
                <th className="text-ink-faint py-1.5 font-normal">欄位</th>
                <th className="text-ink-faint py-1.5 font-normal">值</th>
                <th className="text-ink-faint py-1.5 font-normal">信心</th>
                <th className="text-ink-faint py-1.5 font-normal">來源文字</th>
              </tr>
            </thead>
            <tbody>
              {extractedFields.map((field) => (
                <tr key={field.id} className="border-b border-[var(--surface-line)] align-top">
                  <td className="text-ink-soft py-1.5">{fieldLabel(field.field_name)}</td>
                  <td className="text-ink-soft py-1.5">{field.value ?? "—"}</td>
                  <td className="text-ink-soft py-1.5">
                    {field.confidence === null ? "—" : field.confidence.toFixed(2)}
                  </td>
                  <td className="text-ink-faint py-1.5">{field.source_span ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-5 text-xs">
        <h2 className="text-ink-soft font-medium">澄清歷程</h2>
        {clarifications.length === 0 ? (
          <p className="text-ink-faint">未觸發反問</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {clarifications.map((turn) => (
              <li key={turn.id} className="rounded-[10px] border border-[var(--surface-line)] p-3">
                <p className="text-ink-faint">
                  第 {turn.round} 輪 · 觸發欄位：{fieldLabel(turn.triggered_field)}
                </p>
                <p className="text-ink-soft mt-1">Q：{turn.question}</p>
                <p className="text-ink-soft mt-1">A：{turn.answer ?? "（未回答）"}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-5 text-xs">
        <h2 className="text-ink-soft font-medium">客戶原始描述</h2>
        {rawInputs.length === 0 ? (
          <p className="text-ink-faint">無原始描述</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {rawInputs.map((input) => (
              <li key={input.id} className="rounded-[10px] border border-[var(--surface-line)] p-3">
                <p className="text-ink-faint">{formatDateTime(input.created_at)}</p>
                <p className="text-ink-soft mt-1 whitespace-pre-wrap">{input.raw_text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
```

（拿掉頂部「返回報價列表」`<Link>`——layout 側欄已有報價入口，同 Task 7 的模式。）

- [ ] **Step 2: 調整 `QuoteActions.tsx` 按鈕 class（邏輯完全不動，只改 className 字串）**

把：

```tsx
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
```

改成：

```tsx
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="rounded-[14px] border border-[var(--surface-line)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
```

把：

```tsx
        <button
          type="button"
          data-testid="quote-confirm"
          onClick={handleConfirm}
          disabled={busy}
          className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
        >
```

改成：

```tsx
        <button
          type="button"
          data-testid="quote-confirm"
          onClick={handleConfirm}
          disabled={busy}
          className="bg-ink text-surface rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
        >
```

外層 `<section>` 的 `rounded border p-4` 改成 `card-float rounded-[24px] bg-[var(--surface)] p-5`。`data-testid="quote-amount"`、`data-testid="quote-confirm"` **必須保留原樣**，只加/改 class。

- [ ] **Step 3: 調整 `SendQuoteButton.tsx` 按鈕 class（同樣只改 className）**

外層 `<section>` 的 `rounded border p-4` 改成 `card-float rounded-[24px] bg-[var(--surface)] p-5`；按鈕的 `rounded bg-gray-900 px-3 py-1 text-white` 改成 `bg-ink text-surface rounded-full px-4 py-1.5 text-sm`。`data-testid="quote-send"` 保留。

- [ ] **Step 4: 驗證**

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: 全過。`QuoteActions.test.ts`／`SendQuoteButton.test.ts`（若存在）不測 className，只測行為，故不受影響。

- [ ] **Step 5: E2E 回歸（這個 task 動到 `data-testid` 所在檔案，提前驗證一次）**

```bash
pnpm test:e2e critical-path.spec.ts
```

Expected: 通過。若失敗，優先檢查是否誤刪了 `data-testid` 屬性。

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/quotes/\[id\]/page.tsx src/app/dashboard/quotes/\[id\]/QuoteActions.tsx src/app/dashboard/quotes/\[id\]/SendQuoteButton.tsx
git commit -m "style(dashboard): 報價詳情頁改版，金額獨立深色卡強調，次要區塊視覺降階

WHY
六個 section 原本視覺份量一致，商家要先看的「金額」跟參考用的
「抽取欄位/澄清歷程/原始描述」混在一起。

WHAT
金額移進全頁唯一的深色重點卡（bg-accent-ink）；抽取欄位/澄清歷程/
原始描述改用較小字級與較淡文字色，與報價摘要+操作區的視覺重量
明確拉開層次。QuoteActions/SendQuoteButton 只改按鈕外觀 class，
onClick/disabled/useState 邏輯完全不動，data-testid 全數保留並
已跑 E2E critical-path 驗證。

IMPACT
無邏輯變更，E2E 金路徑（改價/確認/寄送）已驗證通過。"
```

---

### Task 11: 改版 `/dashboard/services`

**Files:**
- Modify: `src/app/dashboard/services/page.tsx`
- Modify: `src/app/dashboard/services/ServicesTable.tsx`（僅 className）
- Modify: `src/app/dashboard/services/NewServiceForm.tsx`（僅 className）

- [ ] **Step 1: `page.tsx` 移除「返回 Dashboard」連結、包卡片容器**

同 Task 7 模式移除 `<Link href="/dashboard" ...>返回 Dashboard</Link>` 與 `if (!auth.ok)` 錯誤 JSX。標題與內容區改成：

```tsx
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">服務項目管理</h1>
      <div className="card-float rounded-[24px] bg-[var(--surface)] p-6">
        <NewServiceForm />
      </div>
      <div className="card-float rounded-[24px] bg-[var(--surface)] p-6">
        <ServicesTable initialItems={items} />
      </div>
      <section className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-6 text-xs">
        <h2 className="text-ink-soft font-medium">加成規則（唯讀）</h2>
        {/* modifiers 表格內容不動，只是外層換容器，欄位/資料邏輯照舊 */}
      </section>
    </main>
```

（`modifiers` 表格內部 JSX 保持原樣，只是外層 `<section>` 從 `flex flex-col gap-2` 改成上面這個 card 容器；`import Link` 若不再使用要移除。）

- [ ] **Step 2: `ServicesTable.tsx` 調整——`is_active=false` 的列降透明度、儲存按鈕圓角**

外層 `<table>` 不動結構（spec C.4：表格適合多欄比較，不改卡片化）。`<tr data-testid={...}>` 加上條件 class：

```tsx
            <tr
              key={item.id}
              data-testid={`service-row-${item.id}`}
              className={`border-b border-[var(--surface-line)] align-top ${
                item.is_active ? "" : "opacity-40"
              }`}
            >
```

儲存按鈕：

```tsx
                      <button
                        type="button"
                        data-testid={`service-save-${item.id}`}
                        onClick={() => handleSave(item.id)}
                        disabled={disabled}
                        className="rounded-[10px] border border-[var(--surface-line)] px-2 py-1 text-sm disabled:opacity-50"
                      >
```

停售按鈕同樣圓角調整為 `rounded-[10px]`。所有 `data-testid` 屬性原樣保留（`service-row-{id}`、`service-base-price-{id}`、`service-save-{id}`）。

- [ ] **Step 3: `NewServiceForm.tsx` 調整——外層與按鈕圓角**

外層 `<form>` 的 `rounded border p-4` 改成 `flex flex-col gap-3`（不再需要自己的邊框，因為 `page.tsx` 已經給它包了 `card-float` 容器）。輸入框與按鈕的 `rounded` 統一改 `rounded-[10px]`；submit 按鈕改 `rounded-full`。

- [ ] **Step 4: 驗證**

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e critical-path.spec.ts
```

Expected: 全過（critical-path 的「改價」步驟直接經過 `ServicesTable.tsx`）。

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/services/page.tsx src/app/dashboard/services/ServicesTable.tsx src/app/dashboard/services/NewServiceForm.tsx
git commit -m "style(dashboard): 服務項目頁包卡片容器，停售列降透明度

WHY/WHAT/IMPACT: 純視覺調整，表格結構刻意保留（多欄比較不適合卡片
化，見 spec C.4）；is_active/base_price 等邏輯與 data-testid 全部
不動，已跑 E2E critical-path（改價步驟）驗證。"
```

---

### Task 12: 改版 `/dashboard/settings`

**Files:**
- Modify: `src/app/dashboard/settings/page.tsx`
- Modify: `src/app/dashboard/settings/SettingsForm.tsx`（僅 className）

- [ ] **Step 1: `page.tsx` 移除連結、包卡片容器**

```tsx
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">帳號設定</h1>
      <div className="card-float rounded-[24px] bg-[var(--surface)] p-6">
        <SettingsForm
          initialDisplayName={merchant.display_name}
          initialSlug={merchant.public_slug}
        />
      </div>
    </main>
```

- [ ] **Step 2: `SettingsForm.tsx` 調整——輸入框與按鈕圓角**

`rounded border px-3 py-2` → `rounded-[10px] border border-[var(--surface-line)] px-3 py-2`；submit 按鈕 `rounded border px-4 py-2` → `rounded-full bg-[var(--ink)] px-4 py-2 text-[var(--surface)]`。`useState`/`fetch`/`aria-describedby`/`role="alert"` 完全不動。

- [ ] **Step 3: 驗證**

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e critical-path.spec.ts
```

Expected: 全過。

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/settings/page.tsx src/app/dashboard/settings/SettingsForm.tsx
git commit -m "style(dashboard): 設定頁包卡片容器，表單邏輯不動"
```

---

### Task 13: 全量回歸 + 人工視覺核對

**Files:** 無新增/修改檔案，純驗證步驟。

- [ ] **Step 1: 全量自動化驗證**

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Expected: 397+ 單元測試全過、lint 無錯誤、build 成功、E2E 兩支（`critical-path.spec.ts`、`signup.spec.ts`）全過。

- [ ] **Step 2: 啟動 dev server，Playwright 對五個頁面截圖存到 scratchpad（一次性腳本，不進正式測試套件）**

```bash
pnpm dev &
sleep 3
```

寫一個一次性腳本 `/tmp/screenshot-dashboard.mjs`（不進 repo）用 Playwright 對登入後的 `/dashboard`、`/dashboard/quotes`、`/dashboard/quotes/[一筆真實id]`、`/dashboard/services`、`/dashboard/settings` 五個頁面截圖，存到系統 scratchpad 目錄。人工開圖核對：漸層底有顯示、卡片圓角/陰影正確、深色金額卡只出現在報價詳情、side rail 的 active 態正確切換。

- [ ] **Step 3: 關閉 dev server**

```bash
kill %1
```

- [ ] **Step 4: 若人工核對發現視覺問題，回到對應 Task 的檔案修正，重新跑該 Task 的驗證步驟，不新開 task**

---

### Task 14: 完成收尾

- [ ] **Step 1: 確認分支上所有 commit 訊息符合 WHY/WHAT/IMPACT 格式**

```bash
git log --oneline main..HEAD
```

- [ ] **Step 2: 載入 sunnydata-branch-lifecycle skill 完成分支收尾（merge/PR/keep 三選一，依使用者當下決定）**
