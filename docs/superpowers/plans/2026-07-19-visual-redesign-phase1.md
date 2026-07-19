# 全站視覺重設計 Phase 1：Landing / 登入 / 註冊 / Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or the Execute Plan phase of superpowers:sunnydata-design to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地新的簡約 SaaS 視覺 token 系統，並套用到首頁、登入、註冊、onboarding 四個頁面。

**Architecture:** 純樣式變更。在 `globals.css` 重寫色彩/陰影 token（黑白無彩色 + 深藍強調色，移除暖色 `aura-bg`/`card-float`），四個頁面元件改用新 token 對應的 Tailwind utility class，不改動任何邏輯、Server Action、或資料流。

**Tech Stack:** Tailwind CSS 4（`@theme inline`），Next.js 16 App Router，既有 Geist Sans。

**已知邊界（已與使用者確認）：** `globals.css` 的 token 全站共用，Phase 1 落地後，尚未改版的後台（`/dashboard`，Phase 3 才處理）會立即跟著換色（暖橘紅 → 新深藍、`aura-bg`/`card-float` 因 class 移除而變純平面），但不影響版面結構與可讀性，是刻意接受的過渡期外觀。

**範圍外：** 深色模式完整實作、shadcn/ui 導入、Phase 2（報價向導）與 Phase 3（後台）——那兩階段合併後各自另開分支與計畫。

**測試策略：** 純樣式變更，無行為異動，不適用 TDD 的 RED-GREEN 流程（沒有可斷言的邏輯）。改以下列方式驗證：(1) 每個任務後跑 `pnpm lint` 確認無語法/規則錯誤 (2) 全部任務完成後跑 `pnpm test` 確認既有 475 個測試不受影響（已確認 `login/actions.test.ts`、`signup/actions.test.ts` 只測 Server Action 邏輯，不斷言 markup，不受樣式改動影響）(3) 最終用 `pnpm dev` 實際開瀏覽器過一輪 golden path 並檢查文字對比度。

---

### Task 1: 重寫 globals.css 色彩與陰影 token

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 確認現有內容作為改動基準**

Run: `cat src/app/globals.css`

（已於 Phase 1 探索階段讀過，內容見下方 Step 2 的完整替換版本，此步驟純核對無變更）

- [ ] **Step 2: 用新 token 系統覆寫全檔**

將 `src/app/globals.css` 完整內容替換為：

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #0f1115;

  --ink: #0f1115;
  --ink-soft: #5b6270;
  --ink-faint: #71767f;
  --surface: #ffffff;
  --surface-subtle: #f7f8fa;
  --surface-line: #e3e5e9;
  --accent-ink: #1b1a20;

  --accent: #2451c4;
  --accent-hover: #1c3f9e;
  --accent-soft: #e8edfb;

  --danger: #c4322c;
  --danger-soft: #fbe9e8;

  --status-review-bg: #fdf3e3;
  --status-review-fg: #92661a;
  --status-confirmed-bg: #e8edfb;
  --status-confirmed-fg: #2451c4;
  --status-sent-bg: #e6f4ec;
  --status-sent-fg: #1a7a4c;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-ink-faint: var(--ink-faint);
  --color-surface: var(--surface);
  --color-surface-subtle: var(--surface-subtle);
  --color-surface-line: var(--surface-line);
  --color-accent-ink: var(--accent-ink);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-soft: var(--accent-soft);
  --color-danger: var(--danger);
  --color-danger-soft: var(--danger-soft);
  --color-status-review-bg: var(--status-review-bg);
  --color-status-review-fg: var(--status-review-fg);
  --color-status-confirmed-bg: var(--status-confirmed-bg);
  --color-status-confirmed-fg: var(--status-confirmed-fg);
  --color-status-sent-bg: var(--status-sent-bg);
  --color-status-sent-fg: var(--status-sent-fg);
  --shadow-card: 0 1px 2px rgba(15, 17, 21, 0.04), 0 1px 8px rgba(15, 17, 21, 0.06);
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
  font-family: var(--font-sans), Arial, Helvetica, sans-serif;
}
```

移除項目說明：
- `.aura-bg`、`.card-float`（暖色系裝飾 class，依 spec 移除；後台 `dashboard/*` 檔案引用處會退化為無背景圖樣/無陰影，屬已與使用者確認的過渡期外觀，Phase 3 處理）

**刻意保留、不動的項目**（探索階段誤判為「無引用」，已修正）：
- `--accent-ink` 與其 `--color-accent-ink` 映射：`dashboard/quotes/[id]/page.tsx` 用 `bg-accent-ink` 做金額顯示區塊的深色底，Phase 1 不動它、原值原樣保留，避免該頁面在 Phase 3 之前失去底色
- `@media (prefers-color-scheme: dark)` 區塊：`WizardPage.tsx`、`StepResult.tsx`（Phase 2 尚未處理）用到 `bg-background`/`text-foreground`，此區塊決定這兩個 class 在系統深色模式下的行為，移除會讓 Phase 2 檔案的深色模式意外跟著變化，故保留原樣

- [ ] **Step 3: 驗證 lint 通過**

Run: `pnpm lint`
Expected: 無錯誤（CSS 檔案不受 ESLint 檢查，此步驟主要確認未誤觸其他檔案）

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(ui): 重寫 globals.css 為簡約 SaaS 色彩系統

WHY：landing/登入/註冊/onboarding 用 Tailwind 預設 zinc 灰階，與後台既有
暖色系不一致；使用者決定全站改採簡約專業風格（黑白無彩色+單一深藍強調色）。

WHAT：--ink/--surface 系列改用冷中性色階；新增 --accent(#2451c4)/--accent-hover/
--accent-soft 取代暖橘紅；狀態徽章三色保留但降飽和度；新增 --danger 語意色；
新增 --shadow-card 單層陰影 token 取代 --card-float 雙層暖色陰影；移除
aura-bg 漸層背景 class。

IMPACT：globals.css 全站共用，此改動會讓尚未重設計的後台（Phase 3 才處理）
立即跟著換色（暖橘紅→深藍、失去 aura-bg/card-float 視覺效果），版面結構
不受影響、可讀性不受影響，是與使用者確認過的過渡期外觀，Phase 3 會收尾。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 重設計首頁 `src/app/page.tsx`

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 替換頁面內容**

將 `src/app/page.tsx` 完整內容替換為：

```tsx
import Link from "next/link";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";

/**
 * BizMate 首頁（根目錄）。
 * 多租戶重構後報價入口是各商家的專屬連結 /q/{slug}，首頁不再直連 wizard，
 * 改導流註冊/登入。
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-10 px-6 py-24">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium text-accent">BizMate</p>
        <h1 className="text-4xl font-semibold tracking-tight text-ink text-balance sm:text-5xl">
          把口語需求，變成有依據的正式報價單
        </h1>
        <p className="text-base text-ink-soft">
          註冊帳號、管理你的服務與價格，把專屬連結傳給客戶自動報價。
        </p>
        <div className="flex items-center gap-4 pt-2">
          <Link
            href={PAGE_ROUTES.signup}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            開始使用
          </Link>
          <Link
            href={PAGE_ROUTES.login}
            className="text-sm font-medium text-ink-soft hover:text-ink"
          >
            已有帳號？登入
          </Link>
        </div>
      </header>

      <section aria-labelledby="categories-heading" className="flex flex-col gap-3">
        <h2 id="categories-heading" className="text-sm font-medium text-ink-soft">
          支援案件類型
        </h2>
        <ul className="flex flex-wrap gap-2">
          {Object.entries(CASE_CATEGORY_LABELS).map(([key, label]) => (
            <li
              key={key}
              className="rounded-xl border border-surface-line px-4 py-1.5 text-sm text-ink"
            >
              {label}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-ink-faint">
        已有商家連結？直接開啟{" "}
        <code className="rounded-md bg-surface-subtle px-1.5 py-0.5 text-ink-soft">
          /q/商家代號
        </code>{" "}
        即可開始報價。
      </p>
    </main>
  );
}
```

變更重點：移除 `tracking-widest uppercase` 裝飾字排版（spec 定案移除），標題升級為 `text-4xl`/`text-5xl` 加強視覺層次，主按鈕從 `rounded bg-zinc-900` 改為 `rounded-xl bg-accent`，圓角統一 `rounded-xl`。

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 無錯誤

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(ui): 首頁套用簡約 SaaS 視覺（WBS 視覺重設計 Phase 1）

WHY：首頁沿用 Tailwind 預設 zinc 灰階與裝飾性大寫字排版，與新定案的簡約
SaaS 方向不符。

WHAT：套用 Task 1 新增的 ink/surface/accent token；移除 tracking-widest
uppercase 標籤字；主 CTA 改用 accent 藍色系、rounded-xl 圓角；強化標題
字級層次。

IMPACT：純樣式變更，無互動邏輯改動，PAGE_ROUTES 連結目標不變。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 重設計登入頁 `src/app/login/`

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/login/LoginForm.tsx`

- [ ] **Step 1: 替換 page.tsx**

```tsx
import Link from "next/link";
import { LoginForm } from "./LoginForm.tsx";

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold text-ink">登入 BizMate</h1>
      <LoginForm />
      <p className="text-sm text-ink-soft">
        還沒有帳號？{" "}
        <Link href="/signup" className="font-medium text-accent hover:text-accent-hover">
          註冊
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: 替換 LoginForm.tsx**

```tsx
"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions.ts";

const INITIAL_STATE: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    loginAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-xl border border-surface-line px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-ink">
          密碼
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-xl border border-surface-line px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>
      {state.error !== null && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        data-testid="login-submit"
        disabled={isPending}
        className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {isPending ? "登入中…" : "登入"}
      </button>
    </form>
  );
}
```

`data-testid="login-submit"` 保持不變（供既有測試/E2E 選取，不可移除或改名）。

- [ ] **Step 3: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 4: 執行相關測試確認未受影響**

Run: `pnpm vitest run src/app/login/`
Expected: 全數通過（`actions.test.ts` 不測 markup，樣式改動不影響）

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx src/app/login/LoginForm.tsx
git commit -m "$(cat <<'EOF'
feat(ui): 登入頁套用簡約 SaaS 視覺（WBS 視覺重設計 Phase 1）

WHY：延續首頁與 Task 1 的新色彩系統，登入頁沿用舊 zinc/黑色按鈕與無圓角
輸入框，風格不一致。

WHAT：輸入框改 rounded-xl 圓角 + focus 態用 accent 色環；主按鈕改 accent
藍；錯誤訊息 text-red-600 改用語意化 text-danger token。

IMPACT：純樣式變更，data-testid="login-submit" 保留不變，Server Action
邏輯未觸碰。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 重設計註冊頁 `src/app/signup/`

**Files:**
- Modify: `src/app/signup/page.tsx`
- Modify: `src/app/signup/SignupForm.tsx`

- [ ] **Step 1: 替換 page.tsx**

```tsx
import Link from "next/link";
import { SignupForm } from "./SignupForm.tsx";

export default function SignupPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold text-ink">註冊 BizMate</h1>
      <SignupForm />
      <p className="text-sm text-ink-soft">
        已經有帳號？{" "}
        <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
          登入
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: 替換 SignupForm.tsx**

```tsx
"use client";

import { useActionState } from "react";
import { signupAction, type SignupState } from "./actions.ts";

const INITIAL_STATE: SignupState = { error: null, verificationSent: false };

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(
    signupAction,
    INITIAL_STATE,
  );

  if (state.verificationSent) {
    return (
      <p
        data-testid="signup-verification-sent"
        className="max-w-sm text-center text-sm text-ink-soft"
      >
        請檢查你的信箱，點擊驗證連結後即可登入。
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-xl border border-surface-line px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-ink">
          密碼
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className="rounded-xl border border-surface-line px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>
      {state.error !== null && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        data-testid="signup-submit"
        disabled={isPending}
        className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {isPending ? "註冊中…" : "註冊"}
      </button>
    </form>
  );
}
```

`data-testid="signup-submit"`、`data-testid="signup-verification-sent"` 保持不變。

- [ ] **Step 3: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 4: 執行相關測試**

Run: `pnpm vitest run src/app/signup/`
Expected: 全數通過

- [ ] **Step 5: Commit**

```bash
git add src/app/signup/page.tsx src/app/signup/SignupForm.tsx
git commit -m "$(cat <<'EOF'
feat(ui): 註冊頁套用簡約 SaaS 視覺（WBS 視覺重設計 Phase 1）

WHY：與登入頁相同問題，延續一致的表單視覺規範。

WHAT：與 Task 3 登入頁採用相同的輸入框/按鈕/錯誤文字樣式規範，維持兩頁
視覺一致。

IMPACT：純樣式變更，data-testid 保留不變。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 重設計 Onboarding 頁 `src/app/onboarding/`

**Files:**
- Modify: `src/app/onboarding/page.tsx`
- Modify: `src/app/onboarding/OnboardingForm.tsx`

- [ ] **Step 1: 替換 page.tsx**

```tsx
import { OnboardingForm } from "./OnboardingForm.tsx";

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold text-ink">歡迎使用 BizMate</h1>
      <p className="max-w-sm text-center text-sm text-ink-soft">
        填寫商家名稱，系統會自動產生你的專屬報價連結。
      </p>
      <OnboardingForm />
    </main>
  );
}
```

- [ ] **Step 2: 替換 OnboardingForm.tsx**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function OnboardingForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const res = await fetch("/api/dashboard/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error ?? "發生未預期的錯誤，請稍後再試");
        setIsPending(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("網路異常，請稍後再試");
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="display_name" className="text-sm font-medium text-ink">
          商家名稱
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="rounded-xl border border-surface-line px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        data-testid="onboarding-submit"
        disabled={isPending}
        className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {isPending ? "建立中…" : "開始使用"}
      </button>
    </form>
  );
}
```

`data-testid="onboarding-submit"` 保持不變。此檔案邏輯（`fetch`/`router.push`/state 管理）完全不動，僅 className 變更。

- [ ] **Step 3: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 4: 執行完整測試套件**

Run: `pnpm test`
Expected: 全數通過（此為 Phase 1 最後一個檔案改動，跑全套作最終確認）

- [ ] **Step 5: Commit**

```bash
git add src/app/onboarding/page.tsx src/app/onboarding/OnboardingForm.tsx
git commit -m "$(cat <<'EOF'
feat(ui): onboarding 頁套用簡約 SaaS 視覺（WBS 視覺重設計 Phase 1）

WHY：與登入/註冊頁相同問題，完成 Phase 1 最後一個頁面的視覺統一。

WHAT：採用與 Task 3/4 相同的輸入框/按鈕/錯誤文字樣式規範。

IMPACT：純樣式變更，data-testid 保留不變，fetch/router 邏輯未觸碰。
Phase 1（landing/登入/註冊/onboarding）全數完成。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 瀏覽器實測與對比度檢查

**Files:** 無程式碼變更，純驗證任務

- [ ] **Step 1: 啟動 dev server**

Run: `pnpm dev`
Expected: 伺服器啟動於 `http://localhost:3000`

- [ ] **Step 2: 走過四個頁面的視覺與互動**

手動或用瀏覽器工具檢查：
- `/`：首頁排版、CTA 按鈕 hover 態、案件類型標籤
- `/login`：表單 focus 態（點擊輸入框應出現 accent 色環）、故意留空必填欄位確認錯誤文字為 `--danger` 紅色且可讀
- `/signup`：同上，並確認密碼少於 6 碼的錯誤訊息
- `/onboarding`：需先登入才可達（若無測試帳號可跳過實際互動，僅檢查靜態渲染）

- [ ] **Step 3: 對比度計算結果（已於規劃階段算出，此步驟為實測覆核）**

用 WCAG 2.1 relative luminance 公式算出的結果（見下表），Task 1 的 token 值已依此定案：

| 組合 | 對比度 | AA 一般文字（4.5:1） |
|:---|---:|:---|
| `--ink` on `--surface` | 18.90:1 | PASS |
| `--ink-soft` on `--surface` | 6.13:1 | PASS |
| `--ink-faint` on `--surface` | 4.57:1 | PASS（原值 `#9aa0ab` 僅 2.63:1 不合格，已調深為 `#71767f`） |
| `--danger` on `--surface` | 5.47:1 | PASS |
| `white` on `--accent` | 6.89:1 | PASS |
| `--status-review-fg` on `--status-review-bg` | 4.62:1 | PASS |
| `--status-confirmed-fg` on `--status-confirmed-bg` | 5.88:1 | PASS |
| `--status-sent-fg` on `--status-sent-bg` | 4.71:1 | PASS |

全數通過 WCAG AA。若瀏覽器實測發現字型渲染或子像素差異造成觀感不同，可用 Chrome DevTools Accessibility 面板覆核；若環境無瀏覽器工具，上表計算結果已足以作為交付依據。

- [ ] **Step 4: 停止 dev server**

Run: `Ctrl+C` 或終止背景程序

---

## Plan Self-Review 記錄

- **Placeholder 掃描**：無 TBD/TODO，所有 Task 的程式碼區塊皆為完整可執行內容
- **Spec 覆蓋率**：色彩 token（Task 1）、字型/圓角/陰影（Task 1+ 各頁 className）、四個 Phase 1 檔案（Task 2-5）、驗證方式（Task 6）— spec 中 Phase 1 範圍全數對應到任務
- **一致性檢查**：四個表單頁（login/signup/onboarding）的 input/button/error className 完全一致，避免同類元件不同寫法
- **data-testid 保留**：`login-submit`、`signup-submit`、`signup-verification-sent`、`onboarding-submit` 於逐一 Step 中明確標註不可移除，對應既有 `actions.test.ts` 與潛在 E2E 依賴
