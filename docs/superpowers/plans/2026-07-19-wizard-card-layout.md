# 客戶端向導卡片式版面重設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or the Execute Plan phase of superpowers:sunnydata-design to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/q/[slug]` 客戶端報價向導從無容器單欄版面改為灰底頁面置中白卡片、
Step 1 三欄大方格 + icon、進度點與頁尾連結統一由 `WizardPage` 渲染在內容下方。

**Architecture:** 純前端 JSX/樣式重構，不動任何狀態流轉、API 呼叫、`data-testid`。
`StepProgress` 呼叫點與頁尾連結（回首頁／重新開始）從四個 Step 元件搬到
`WizardPage`，四步共用同一卡片容器。

**Tech Stack:** Next.js App Router、React、Tailwind（既有 token）、`lucide-react`（已安裝）。

---

## 對應 spec

`docs/superpowers/specs/2026-07-19-wizard-card-layout-design.md`（已核准）

## 驗證策略

這是純 JSX/樣式重構，不新增業務邏輯或純函式，專案既有慣例（見本次會話
dashboard Phase 3 視覺重設計）對此類變更不寫新單元測試，改以「全測試套件
維持全綠 + tsc + eslint + build + 手動走一次四步流程」驗證。所有
`data-testid` 保持不變，既有測試（`StepProgress.test.ts`、`wizardApi.test.ts`）
不受影響、必須持續通過。

---

### Task 1: StepCategory.tsx — 三欄大方格 + icon

**Files:**
- Modify: `src/app/q/[slug]/components/StepCategory.tsx`

- [ ] **Step 1: 改寫檔案**

```tsx
import type { CaseCategory } from "@/shared/types/domain.types";
import { Palette, Brush, LayoutTemplate } from "lucide-react";
import {
  CASE_CATEGORIES,
  CASE_CATEGORY_LABELS,
} from "@/shared/constants/categories.ts";

/**
 * Wizard Step 1：選擇案件類型（FR-CW-1）。
 * 單選即前進——點任一類型直接呼叫 onSelect，交由容器切到 Step 2。
 */
type StepCategoryProps = {
  onSelect: (category: CaseCategory) => void;
  disabled?: boolean;
};

/** 各案件類型的代表圖示（風格辨識用，非精確語意對應）。 */
const CATEGORY_ICONS: Record<CaseCategory, typeof Palette> = {
  graphic_design: Palette,
  illustration: Brush,
  web_design: LayoutTemplate,
};

export function StepCategory({ onSelect, disabled = false }: StepCategoryProps) {
  return (
    <section aria-labelledby="step-category-heading" className="flex flex-col gap-6">
      <header>
        <h1 id="step-category-heading" className="text-3xl font-semibold tracking-tight text-ink">
          你需要哪一類服務？
        </h1>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
        {CASE_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category];
          return (
            <li key={category}>
              <button
                type="button"
                data-testid={`category-option-${category}`}
                disabled={disabled}
                onClick={() => onSelect(category)}
                className="flex min-h-[12rem] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-surface-line px-4 py-6 text-center transition-colors hover:-translate-y-0.5 hover:border-accent hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
              >
                <Icon className="h-10 w-10 text-accent" strokeWidth={1.6} aria-hidden="true" />
                <span className="text-base font-medium text-ink">
                  {CASE_CATEGORY_LABELS[category]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: 確認 data-testid 未變**

Run: `grep -n "data-testid" "src/app/q/[slug]/components/StepCategory.tsx"`
Expected: 三個 `category-option-{graphic_design,illustration,web_design}`，與修改前一致。

---

### Task 2: StepDescribe.tsx — 移除 StepProgress、收斂寬度、標題加大

**Files:**
- Modify: `src/app/q/[slug]/components/StepDescribe.tsx`

- [ ] **Step 1: 移除 import 與 `<StepProgress>` 呼叫**

刪除這一行：
```tsx
import { StepProgress } from "./StepProgress.tsx";
```

- [ ] **Step 2: 調整 `<section>`／`<header>`／`<h1>`**

把：
```tsx
    <section aria-labelledby="step-describe-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <StepProgress current={2} />
        <p className="text-sm font-medium text-ink-soft">{categoryLabel}</p>
        <h1 id="step-describe-heading" className="text-2xl font-semibold tracking-tight text-ink">
          用你的話描述需求
        </h1>
```

改為：
```tsx
    <section aria-labelledby="step-describe-heading" className="mx-auto flex w-full max-w-md flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink-soft">{categoryLabel}</p>
        <h1 id="step-describe-heading" className="text-3xl font-semibold tracking-tight text-ink">
          用你的話描述需求
        </h1>
```

其餘（`<p>` 說明文字、`<form>` 內容、按鈕）不動。

- [ ] **Step 3: 確認檔案不再含 StepProgress**

Run: `grep -n "StepProgress" "src/app/q/[slug]/components/StepDescribe.tsx"`
Expected: 無輸出。

---

### Task 3: StepClarify.tsx — 移除 StepProgress、收斂寬度、標題加大

**Files:**
- Modify: `src/app/q/[slug]/components/StepClarify.tsx`

- [ ] **Step 1: 移除 import**

刪除：
```tsx
import { StepProgress } from "./StepProgress.tsx";
```

- [ ] **Step 2: 調整 `<section>`／`<header>`**

把：
```tsx
    <section
      data-testid="clarify-question"
      aria-labelledby="step-clarify-heading"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-3">
        <StepProgress current={3} />
        <h1 id="step-clarify-heading" className="text-2xl font-semibold tracking-tight text-ink">
          還差幾項資訊
        </h1>
```

改為：
```tsx
    <section
      data-testid="clarify-question"
      aria-labelledby="step-clarify-heading"
      className="mx-auto flex w-full max-w-md flex-col gap-6"
    >
      <header className="flex flex-col gap-3">
        <h1 id="step-clarify-heading" className="text-3xl font-semibold tracking-tight text-ink">
          還差幾項資訊
        </h1>
```

其餘（說明文字、`<form>`、逐題輸入框、按鈕）不動。

- [ ] **Step 3: 確認 data-testid 與 StepProgress 移除**

Run: `grep -n "data-testid\|StepProgress" "src/app/q/[slug]/components/StepClarify.tsx"`
Expected: 只剩 `data-testid="clarify-question"` 與 `data-testid={\`clarify-answer-\${item.targetField}\`}`、`data-testid="clarify-submit"`，無 `StepProgress`。

---

### Task 4: StepResult.tsx — 移除 StepProgress 與重新開始按鈕、收斂寬度、標題加大

**Files:**
- Modify: `src/app/q/[slug]/components/StepResult.tsx`

`onRestart` 改由 `WizardPage` 自行處理（按鈕搬過去），本元件的 props 移除該欄位。

- [ ] **Step 1: 移除 import 並調整 props 型別**

把：
```tsx
import { fetchStatus } from "../lib/wizardApi.ts";
import type { DescribeOutcome } from "../lib/wizardTypes.ts";
import { StepProgress } from "./StepProgress.tsx";
```
改為：
```tsx
import { fetchStatus } from "../lib/wizardApi.ts";
import type { DescribeOutcome } from "../lib/wizardTypes.ts";
```

把：
```tsx
type StepResultProps = {
  sessionId: string;
  outcome: DescribeOutcome;
  onRestart: () => void;
};
```
改為：
```tsx
type StepResultProps = {
  sessionId: string;
  outcome: DescribeOutcome;
};
```

- [ ] **Step 2: 調整函式簽章**

把：
```tsx
export function StepResult({ sessionId, outcome, onRestart }: StepResultProps) {
```
改為：
```tsx
export function StepResult({ sessionId, outcome }: StepResultProps) {
```

- [ ] **Step 3: 調整 `<section>`／`<header>`**

把：
```tsx
    <section aria-labelledby="step-result-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <StepProgress current={4} />
        <h1 id="step-result-heading" className="text-2xl font-semibold tracking-tight text-ink">
```
改為：
```tsx
    <section aria-labelledby="step-result-heading" className="mx-auto flex w-full max-w-md flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 id="step-result-heading" className="text-3xl font-semibold tracking-tight text-ink">
```

- [ ] **Step 4: 移除底部的「重新開始」按鈕**

把：
```tsx
      {!isQuoteAccepted && outcome.outOfScope && (
        <p data-testid="result-out-of-scope" className="text-sm text-ink-soft">
          你的需求超出標準報價範圍，我們已轉由專人評估，將盡快與你聯繫。
        </p>
      )}

      <button
        type="button"
        onClick={onRestart}
        className="text-sm font-medium text-ink-soft hover:text-accent"
      >
        重新開始一筆新報價
      </button>
    </section>
```
改為：
```tsx
      {!isQuoteAccepted && outcome.outOfScope && (
        <p data-testid="result-out-of-scope" className="text-sm text-ink-soft">
          你的需求超出標準報價範圍，我們已轉由專人評估，將盡快與你聯繫。
        </p>
      )}
    </section>
```

- [ ] **Step 5: 確認 data-testid 與 onRestart 皆已處理**

Run: `grep -n "data-testid\|onRestart\|StepProgress" "src/app/q/[slug]/components/StepResult.tsx"`
Expected: 只剩 `data-testid="result-quote-code"` 與 `data-testid="result-out-of-scope"`，無 `onRestart`、無 `StepProgress`。

---

### Task 5: WizardPage.tsx — 卡片容器 + 統一 StepProgress／頁尾連結

**Files:**
- Modify: `src/app/q/[slug]/WizardPage.tsx`

- [ ] **Step 1: 整檔改寫**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { createSession, submitDescribe, submitAnswer } from "./lib/wizardApi.ts";
import type { DescribeOutcome, WizardStep } from "./lib/wizardTypes.ts";
import { StepCategory } from "./components/StepCategory.tsx";
import { StepDescribe } from "./components/StepDescribe.tsx";
import { StepClarify } from "./components/StepClarify.tsx";
import { StepResult } from "./components/StepResult.tsx";
import { StepProgress } from "./components/StepProgress.tsx";

/** WizardStep → StepProgress 的步驟序號，四步固定對應產品流程順序。 */
const STEP_NUMBERS: Record<WizardStep, 1 | 2 | 3 | 4> = {
  category: 1,
  describe: 2,
  clarify: 3,
  result: 4,
};

/**
 * Wizard 容器（任務 3.6）：編排各步驟的狀態流轉（FR-CW-1~4）。
 * 唯一持有跨步驟狀態的地方；各 Step 元件無狀態、只回呼容器。
 * API 呼叫全走 wizardApi（不 throw），失敗以 serverError 回饋、不中斷流程。
 * slug/merchantName 由 server component（page.tsx）解析後注入——
 * 建 session 一律帶 slug，報價歸屬該商家。
 *
 * 卡片式版面（WBS 客戶端向導卡片重設計）：四步共用同一張白卡片容器，
 * 進度點與頁尾連結（回首頁／重新開始）統一在這裡渲染於內容下方，
 * 避免四個 Step 元件各自重複、也讓切換步驟時卡片本身不跳動。
 */
export function WizardPage({
  slug,
  merchantName,
}: {
  slug: string;
  merchantName: string;
}) {
  const [step, setStep] = useState<WizardStep>("category");
  const [category, setCategory] = useState<CaseCategory | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DescribeOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>("");

  /**
   * 依解析結果決定下一畫面：仍需反問（有 questions）→ clarify；否則進 result
   * （出報價 / 超範圍 / 保守估算皆為終態）。describe 與 answer 共用此路由。
   */
  function routeOutcome(next: DescribeOutcome): void {
    setOutcome(next);
    setStep(
      next.status === "awaiting_clarification" && (next.questions?.length ?? 0) > 0
        ? "clarify"
        : "result",
    );
  }

  /** Step 1→2：建立 session 後進入描述步驟。 */
  async function startSession(selected: CaseCategory): Promise<void> {
    setServerError("");
    setCategory(selected);
    const result = await createSession(selected, slug);
    if (!result.ok) {
      setServerError(result.error);
      setStep("category");
      return;
    }
    setSessionId(result.data.sessionId);
    setOutcome(null);
    setStep("describe");
  }

  /** Step 2：送出描述，依 outcome 進反問或結果；失敗留在描述步驟。 */
  async function handleSubmitDescribe(input: {
    rawText: string;
    contactEmail: string;
  }): Promise<void> {
    if (!sessionId) return;
    setServerError("");
    setSubmitting(true);
    const result = await submitDescribe(sessionId, input);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    routeOutcome(result.data);
  }

  /**
   * Step 3：一次回答本輪所有反問（同一 session，不重述描述）。依新 outcome 決定
   * 續問或結果；失敗留在反問畫面，讓客戶重試。
   */
  async function handleSubmitAnswer(
    answers: { field: string; answer: string }[],
  ): Promise<void> {
    if (!sessionId) return;
    setServerError("");
    setSubmitting(true);
    const result = await submitAnswer(sessionId, answers);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    routeOutcome(result.data);
  }

  /** 完全重置，回到類型選擇（開一筆全新報價）。 */
  function handleRestart(): void {
    setStep("category");
    setCategory(null);
    setSessionId(null);
    setOutcome(null);
    setSubmitting(false);
    setServerError("");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-subtle px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-4xl rounded-3xl border border-surface-line bg-surface p-8 shadow-card sm:p-12">
        <p className="mb-6 text-sm font-medium text-ink-soft">
          {merchantName} 的自動報價
        </p>

        {step === "category" && (
          <>
            <StepCategory onSelect={startSession} />
            {serverError && (
              <p role="alert" className="mt-6 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {serverError}
              </p>
            )}
          </>
        )}

        {step === "describe" && category && (
          <StepDescribe
            categoryLabel={CASE_CATEGORY_LABELS[category]}
            submitting={submitting}
            serverError={serverError || undefined}
            onSubmit={handleSubmitDescribe}
            onBack={handleRestart}
          />
        )}

        {step === "clarify" && outcome?.questions && outcome.questions.length > 0 && (
          <StepClarify
            questions={outcome.questions}
            submitting={submitting}
            serverError={serverError || undefined}
            onSubmit={handleSubmitAnswer}
          />
        )}

        {step === "result" && sessionId && outcome && (
          <StepResult sessionId={sessionId} outcome={outcome} />
        )}

        <div className="mt-8 flex flex-col items-center gap-4">
          <StepProgress current={STEP_NUMBERS[step]} />
          {step === "category" && (
            <Link
              href={PAGE_ROUTES.home}
              className="text-sm font-medium text-ink-soft hover:text-accent"
            >
              ← 回首頁
            </Link>
          )}
          {step === "result" && (
            <button
              type="button"
              onClick={handleRestart}
              className="text-sm font-medium text-ink-soft hover:text-accent"
            >
              重新開始一筆新報價
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 確認四步各自的 data-testid 呼叫端未變**

Run: `grep -n "StepCategory\|StepDescribe\|StepClarify\|StepResult" "src/app/q/[slug]/WizardPage.tsx"`
Expected: 四個元件皆被引入並在對應 `step === "..."` 分支渲染，`StepResult` 呼叫不再傳 `onRestart`。

---

### Task 6: loading.tsx — 骨架同步新版面尺寸

**Files:**
- Modify: `src/app/q/[slug]/loading.tsx`

- [ ] **Step 1: 整檔改寫**

```tsx
/**
 * /q/[slug] 進入頁的載入骨架。
 * page.tsx 是 server component，要先查 findBySlug 解析商家才能渲染 wizard；
 * 客戶點開商家分享連結的第一印象若是空白畫面會顯得不可靠，這個 Suspense
 * 邊界讓查詢期間立即有內容佔位，之後由真正的 WizardPage 換入。
 * 外殼尺寸對齊 WizardPage 卡片式版面（bg-surface-subtle 頁面 + max-w-4xl
 * 白卡片 + 三欄大方格骨架），避免骨架換真內容時版面跳動。
 */
export default function QuoteEntryLoading() {
  return (
    <main
      role="status"
      aria-label="頁面載入中"
      className="flex min-h-screen items-center justify-center bg-surface-subtle px-4 py-10 sm:px-6 sm:py-16"
    >
      <div className="w-full max-w-4xl rounded-3xl border border-surface-line bg-surface p-8 shadow-card sm:p-12">
        <div className="mb-6 h-4 w-32 animate-pulse rounded-md bg-surface-line" />
        <div className="mb-8 h-8 w-2/3 animate-pulse rounded-lg bg-surface-line" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
          <div className="h-48 animate-pulse rounded-2xl border border-surface-line bg-surface-subtle" />
          <div className="h-48 animate-pulse rounded-2xl border border-surface-line bg-surface-subtle" />
          <div className="h-48 animate-pulse rounded-2xl border border-surface-line bg-surface-subtle" />
        </div>
        <div className="mt-8 flex justify-center">
          <div className="h-2 w-20 animate-pulse rounded-full bg-surface-line" />
        </div>
      </div>
      <span className="sr-only">載入中…</span>
    </main>
  );
}
```

---

### Task 7: 全套驗證與提交

**Files:** 無新增，驗證 Task 1-6 的合併結果。

- [ ] **Step 1: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤（特別注意 Task 4 移除 `onRestart` 後，`StepResult` 呼叫端若仍傳該 prop 會在此處報錯）。

- [ ] **Step 2: Lint**

Run: `npx eslint "src/app/q/[slug]"`
Expected: 無錯誤。

- [ ] **Step 3: 單元測試全綠**

Run: `npx vitest run`
Expected: 現有測試數全數通過（`StepProgress.test.ts`、`wizardApi.test.ts` 不受影響）。

- [ ] **Step 4: Build**

Run: `npx next build`
Expected: 成功，`/q/[slug]` 路由正常產出。

- [ ] **Step 5: 手動走一次四步流程**

`npx next dev` 起本機伺服器，開 `http://localhost:3000/q/{dev-slug}`：
- Step 1：三欄方格在桌面寬度並排、icon 與文字置中，手機寬度（DevTools 模擬 375px）疊為單欄
- 點任一類型 → 卡片本身尺寸不跳動，只換內容為 Step 2 描述表單
- 送出描述 → 視測試資料觸發反問或直接出結果，確認 Step 3/4 內容置中收斂為窄欄、不會被拉滿整張卡片寬度
- 全程確認進度點與對應頁尾連結（回首頁 / 重新開始）顯示在卡片內容下方、位置四步一致

- [ ] **Step 6: Commit**

```bash
git add "src/app/q/[slug]"
git commit -m "$(cat <<'EOF'
feat(ui): 客戶端向導改卡片式版面（WBS 客戶端向導卡片重設計）

使用者回報 /q/[slug] 報價向導元素太小且擁擠，並提供參考圖：灰底頁面
置中白卡片、Step 1 三欄大方格選項、進度點在內容下方、回首頁連結在
卡片底部。依 sunnydata-design 流程完成 spec（已核准）後實作。

四步共用同一張白卡片容器（max-w-4xl），切換步驟時卡片本身不跳動、
只換內容。StepProgress 與頁尾連結（回首頁／重新開始）從四個 Step
元件搬到 WizardPage 統一渲染在內容之下，消除四份重複呼叫、也讓四步
的「內容→進度點→頁尾連結」順序一致（此前 StepProgress 在標題之上、
重新開始按鈕散落在 StepResult 內部，與參考圖的結構不同）。

Step 1 三個類型選項加上代表圖示（Palette/Brush/LayoutTemplate，
lucide-react 既有依賴），方格加大為 min-h-12rem 並改三欄 grid（手機
寬度自動疊為單欄）。Step 2-4 的表單內容收斂為 max-w-md，避免文字
欄位被拉到跟三欄方格一樣寬。標題字級 text-2xl 統一調整為 text-3xl。

純樣式與 JSX 結構調整，不動狀態流轉、API 呼叫、data-testid、
aria 語意。/q/[slug]/loading.tsx 同步更新骨架尺寸，避免載入完成時
版面跳動。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: 確認 commit 成功**

Run: `git log --oneline -1 && git status --short`
Expected: 最新 commit 為上述訊息，工作區乾淨（除既有 `.claude/taskmaster-data/.session-start` 這類非本次相關變更外）。
