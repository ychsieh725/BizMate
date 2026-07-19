# 全站視覺重設計 Phase 2：報價向導 `/q/[slug]` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or the Execute Plan phase of superpowers:sunnydata-design to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Phase 1 落地的簡約 SaaS 視覺 token 套到客戶端報價向導（五個檔案），並新增點狀進度指示器強化步驟感。

**Architecture:** 純樣式變更 + 一個新的小型展示元件（`StepProgress`）。不改動 `WizardPage.tsx` 的狀態機邏輯、任何 API 呼叫、或 `wizardApi.ts`/`wizardTypes.ts`。

**Tech Stack:** 沿用 Phase 1 的 `globals.css` token（`ink`/`surface`/`accent`/`danger` 等），Tailwind CSS 4。

**已與使用者確認的設計決定：**
- 步驟指示器改為點狀進度條（非純文字「步驟 N/4」），並列一段 `sr-only` 文字供螢幕閱讀器使用，不犧牲既有 a11y
- 圓角統一為 `rounded-xl`（表單元素）/`rounded-2xl`（卡片），取代原本的 `rounded-full` 藥丸按鈕與混用的圓角
- focus 態統一為 `focus:` 系列（對齊 Phase 1 login/signup 表單的寫法），取代原本的 `focus-visible:`
- 深色模式（`dark:` class）依 Phase 1 同樣的「本次僅淺色」決定移除；`bg-foreground`/`text-foreground`/`bg-background`/`text-background` 這類通用 Tailwind token 全面替換為新設計系統的 `ink`/`accent`/`white` token

**⚠️ E2E 選取器約束（絕對不可變動）：** `tests/e2e/pages/CustomerWizardPage.ts` 直接依賴以下 `data-testid`，任何一個消失或改名都會讓 E2E 金路徑測試（`tests/e2e/critical-path.spec.ts`）失敗：
`category-option-{category}`、`describe-raw-text`、`describe-email`、`describe-submit`、`clarify-question`、`result-quote-code`、`result-out-of-scope`。另有 `clarify-answer-{field}`、`clarify-submit` 雖非目前 E2E 直接斷言，同樣不可移除。

**範圍外：** Phase 3（後台）、深色模式完整實作、`WizardPage.tsx` 的狀態機/API 邏輯。

**測試策略：** 本階段新增一個有實際邏輯的元件（`StepProgress` 的填色判斷），採 TDD（RED→GREEN）；其餘四個既有 Step 元件是純樣式變更，做法同 Phase 1——不寫新測試，靠 `pnpm lint`/`tsc`/既有測試/E2E 選取器保留來驗證。

---

### Task 1: 新增 StepProgress 元件（TDD）

**Files:**
- Create: `src/app/q/[slug]/components/StepProgress.tsx`
- Test: `src/app/q/[slug]/components/StepProgress.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `src/app/q/[slug]/components/StepProgress.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { isStepFilled } from "./StepProgress.tsx";

/**
 * StepProgress 的填色判斷（純函式，抽出以利獨立測試，同 dashboard/StatusPill 慣例）。
 * 規則：小於等於目前步驟的點都視為「已填」（含目前步驟本身），之後的點未填。
 */
describe("isStepFilled", () => {
  it("目前步驟本身視為已填", () => {
    expect(isStepFilled(2, 2)).toBe(true);
  });

  it("已完成的步驟視為已填", () => {
    expect(isStepFilled(1, 3)).toBe(true);
  });

  it("尚未到達的步驟視為未填", () => {
    expect(isStepFilled(3, 1)).toBe(false);
  });

  it("第一步時只有第一點已填", () => {
    expect(isStepFilled(1, 1)).toBe(true);
    expect(isStepFilled(2, 1)).toBe(false);
  });

  it("最後一步時全部已填", () => {
    expect(isStepFilled(1, 4)).toBe(true);
    expect(isStepFilled(4, 4)).toBe(true);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/app/q/[slug]/components/StepProgress.test.ts`
Expected: FAIL，錯誤訊息含「Cannot find module './StepProgress.tsx'」或 `isStepFilled is not a function`（檔案尚未建立）

- [ ] **Step 3: 寫最小實作**

建立 `src/app/q/[slug]/components/StepProgress.tsx`：

```tsx
const TOTAL_STEPS = 4;

/** 純函式：判斷某個進度點是否應顯示為已填（目前步驟與之前的步驟）。 */
export function isStepFilled(step: number, current: number): boolean {
  return step <= current;
}

/**
 * 五步驟精靈的視覺進度指示器（WBS 視覺重設計 Phase 2）。
 * 點狀進度條取代原本的文字「步驟 N/4」；用 sr-only 文字保留螢幕閱讀器可讀性，
 * 視覺點本身標 aria-hidden 避免重複朗讀。
 */
export function StepProgress({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = Array.from({ length: TOTAL_STEPS }, (_, index) => index + 1);

  return (
    <div className="flex items-center gap-2">
      <span className="sr-only">
        步驟 {current} / {TOTAL_STEPS}
      </span>
      <div aria-hidden="true" className="flex items-center gap-2">
        {steps.map((step) => (
          <span
            key={step}
            className={`h-2 rounded-full transition-all ${
              isStepFilled(step, current) ? "w-6 bg-accent" : "w-2 bg-surface-line"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/app/q/[slug]/components/StepProgress.test.ts`
Expected: PASS，5 個測試全過

- [ ] **Step 5: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 6: Commit**

```bash
git add src/app/q/[slug]/components/StepProgress.tsx src/app/q/[slug]/components/StepProgress.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): 新增報價向導點狀進度指示器（WBS 視覺重設計 Phase 2）

WHY：五個步驟原本各自用文字「步驟 N/4」（tracking-widest uppercase 裝飾字），
與 Phase 1 已移除的 landing 頁裝飾性排版風格相同，且進度感不夠直觀。

WHAT：新增 StepProgress 元件，4 個點狀進度條，已完成/目前步驟為 accent 填色
拉長的藥丸、未到達的為淺灰小圓點。填色判斷抽成純函式 isStepFilled 並用 TDD
（RED→GREEN）覆蓋 5 個邊界案例，同 dashboard/StatusPill.tsx 的既有慣例
（狀態→樣式的對照抽成可獨立測試的純函式）。sr-only 文字保留原本「步驟 N/4」
的可讀資訊，視覺點 aria-hidden，避免螢幕閱讀器重複朗讀兩次。

IMPACT：新增檔案，尚未套用到任何既有 Step 元件（Task 3-6 才套用）。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 重設計 WizardPage.tsx 容器

**Files:**
- Modify: `src/app/q/[slug]/WizardPage.tsx`

- [ ] **Step 1: 替換內容**

將 `src/app/q/[slug]/WizardPage.tsx` 完整內容替換為：

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

/**
 * Wizard 容器（任務 3.6）：編排各步驟的狀態流轉（FR-CW-1~4）。
 * 唯一持有跨步驟狀態的地方；各 Step 元件無狀態、只回呼容器。
 * API 呼叫全走 wizardApi（不 throw），失敗以 serverError 回饋、不中斷流程。
 * slug/merchantName 由 server component（page.tsx）解析後注入——
 * 建 session 一律帶 slug，報價歸屬該商家。
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
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <header className="text-sm font-medium text-ink-soft">
        {merchantName} 的自動報價
      </header>
      {step === "category" && (
        <>
          <StepCategory onSelect={startSession} />
          {serverError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {serverError}
            </p>
          )}
          <Link
            href={PAGE_ROUTES.home}
            className="text-sm font-medium text-ink-soft hover:text-accent"
          >
            ← 回首頁
          </Link>
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
        <StepResult
          sessionId={sessionId}
          outcome={outcome}
          onRestart={handleRestart}
        />
      )}
    </main>
  );
}
```

變更重點：`text-zinc-500` → `text-ink-soft`；錯誤訊息 `bg-red-50 text-red-700 dark:*` → `bg-danger-soft text-danger`（移除 dark: 變體）；「回首頁」連結 `text-zinc-500 hover:text-foreground` → `text-ink-soft hover:text-accent`。狀態機邏輯（`routeOutcome`/`startSession`/`handleSubmitDescribe`/`handleSubmitAnswer`/`handleRestart`）逐字不動。

- [ ] **Step 2: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/app/q/\[slug\]/WizardPage.tsx
git commit -m "$(cat <<'EOF'
feat(ui): 報價向導容器套用新視覺 token（WBS 視覺重設計 Phase 2）

WHY：延續 Phase 1 的 token 系統，容器層的錯誤提示與連結樣式對齊新設計。

WHAT：zinc 灰階改 ink-soft；錯誤訊息改用語意化 danger token 並移除 dark:
變體；連結 hover 態改 accent 色。狀態機邏輯（routeOutcome/startSession/
handleSubmitDescribe/handleSubmitAnswer/handleRestart）完全不動。

IMPACT：純樣式變更，API 呼叫與狀態流轉不受影響。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 重設計 StepCategory.tsx

**Files:**
- Modify: `src/app/q/[slug]/components/StepCategory.tsx`

- [ ] **Step 1: 替換內容**

```tsx
import type { CaseCategory } from "@/shared/types/domain.types";
import {
  CASE_CATEGORIES,
  CASE_CATEGORY_LABELS,
} from "@/shared/constants/categories.ts";
import { StepProgress } from "./StepProgress.tsx";

/**
 * Wizard Step 1：選擇案件類型（FR-CW-1）。
 * 單選即前進——點任一類型直接呼叫 onSelect，交由容器切到 Step 2。
 */
type StepCategoryProps = {
  onSelect: (category: CaseCategory) => void;
  disabled?: boolean;
};

export function StepCategory({ onSelect, disabled = false }: StepCategoryProps) {
  return (
    <section aria-labelledby="step-category-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <StepProgress current={1} />
        <h1 id="step-category-heading" className="text-2xl font-semibold tracking-tight text-ink">
          你需要哪一類服務？
        </h1>
      </header>

      <ul className="flex flex-col gap-3">
        {CASE_CATEGORIES.map((category) => (
          <li key={category}>
            <button
              type="button"
              data-testid={`category-option-${category}`}
              disabled={disabled}
              onClick={() => onSelect(category)}
              className="flex w-full items-center justify-between rounded-2xl border border-surface-line px-5 py-4 text-left text-base font-medium text-ink transition-colors hover:border-accent hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
            >
              <span>{CASE_CATEGORY_LABELS[category]}</span>
              <span aria-hidden="true" className="text-ink-faint">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`data-testid={`category-option-${category}`}` 保持不變（E2E 依賴）。

- [ ] **Step 2: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/app/q/\[slug\]/components/StepCategory.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Step 1 選類型套用新視覺 token 與進度指示器（WBS 視覺重設計 Phase 2）

WHY：延續 Phase 1 token；文字「步驟 1/4」改為 Task 1 新增的點狀進度條。

WHAT：卡片按鈕邊框改 surface-line、hover 態改 accent 邊框+底色、focus 態改
accent 色環；箭頭圖示改 ink-faint。移除 dark: 變體。

IMPACT：純樣式變更，data-testid="category-option-{category}" 保留不變，
onSelect 呼叫邏輯不動。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 重設計 StepDescribe.tsx

**Files:**
- Modify: `src/app/q/[slug]/components/StepDescribe.tsx`

- [ ] **Step 1: 替換內容**

```tsx
"use client";

import { useState } from "react";
import { StepProgress } from "./StepProgress.tsx";

/**
 * Wizard Step 2：口語描述 + 聯絡 email（FR-CW-2）。
 * 前端做即時格式回饋（email、非空），後端 zod 仍會再驗一次——前端驗證只為體驗，不是信任邊界。
 */
type StepDescribeProps = {
  categoryLabel: string;
  submitting: boolean;
  serverError?: string;
  onSubmit: (input: { rawText: string; contactEmail: string }) => void;
  onBack: () => void;
};

/** 與後端 z.string().email() 對齊的寬鬆前端檢查（僅即時回饋用）。 */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function StepDescribe({
  categoryLabel,
  submitting,
  serverError,
  onSubmit,
  onBack,
}: StepDescribeProps) {
  const [rawText, setRawText] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [touched, setTouched] = useState(false);

  const rawTextError = rawText.trim().length === 0 ? "請描述你的需求" : "";
  const emailError = !isValidEmail(contactEmail) ? "請輸入正確的 email 格式" : "";
  const hasError = rawTextError !== "" || emailError !== "";

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setTouched(true);
    if (hasError) return;
    onSubmit({ rawText: rawText.trim(), contactEmail: contactEmail.trim() });
  }

  return (
    <section aria-labelledby="step-describe-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <StepProgress current={2} />
        <p className="text-sm font-medium text-ink-soft">{categoryLabel}</p>
        <h1 id="step-describe-heading" className="text-2xl font-semibold tracking-tight text-ink">
          用你的話描述需求
        </h1>
        <p className="text-sm text-ink-soft">
          越具體越好：用途、數量、交期、預算等。
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="raw-text" className="text-sm font-medium text-ink">
            需求描述
          </label>
          <textarea
            id="raw-text"
            data-testid="describe-raw-text"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            onBlur={() => setTouched(true)}
            rows={6}
            disabled={submitting}
            aria-invalid={touched && rawTextError !== ""}
            aria-describedby={rawTextError ? "raw-text-error" : undefined}
            placeholder="例：我想要一張 A2 尺寸的活動海報，商業用途，兩週內完成。"
            className="resize-y rounded-xl border border-surface-line px-4 py-3 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
          />
          {touched && rawTextError && (
            <p id="raw-text-error" role="alert" className="text-sm text-danger">
              {rawTextError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-email" className="text-sm font-medium text-ink">
            聯絡 email
          </label>
          <input
            id="contact-email"
            data-testid="describe-email"
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            onBlur={() => setTouched(true)}
            disabled={submitting}
            aria-invalid={touched && emailError !== ""}
            aria-describedby={emailError ? "contact-email-error" : undefined}
            placeholder="you@example.com"
            className="rounded-xl border border-surface-line px-4 py-3 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
          />
          {touched && emailError && (
            <p id="contact-email-error" role="alert" className="text-sm text-danger">
              {emailError}
            </p>
          )}
        </div>

        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {serverError}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            className="h-12 rounded-xl border border-surface-line px-5 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle disabled:opacity-50"
          >
            ← 上一步
          </button>
          <button
            type="submit"
            data-testid="describe-submit"
            disabled={submitting}
            className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-accent px-6 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? "解析中…" : "送出需求"}
          </button>
        </div>
      </form>
    </section>
  );
}
```

`data-testid="describe-raw-text"`、`data-testid="describe-email"`、`data-testid="describe-submit"` 保持不變（E2E 依賴）。`isValidEmail`、`handleSubmit` 驗證邏輯逐字不動。

- [ ] **Step 2: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 3: 執行 wizardApi 測試確認未受影響**

Run: `pnpm vitest run src/app/q/`
Expected: 全數通過（此目錄下唯一測試是 `wizardApi.test.ts`，只測 API 呼叫邏輯不測 markup）

- [ ] **Step 4: Commit**

```bash
git add src/app/q/\[slug\]/components/StepDescribe.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Step 2 描述需求套用新視覺 token（WBS 視覺重設計 Phase 2）

WHY：延續前兩個 Task 的 token 系統，統一表單元件規範。

WHAT：輸入框圓角從 rounded-2xl 改 rounded-xl（對齊 Phase 1 表單規範）、
focus 態改 accent 色環；主按鈕從 rounded-full bg-foreground 改
rounded-xl bg-accent；次按鈕（上一步）改 border-surface-line；錯誤文字
統一 text-danger；移除 dark: 變體；文字「步驟 2/4」改為 StepProgress。

IMPACT：純樣式變更，data-testid（describe-raw-text/describe-email/
describe-submit）保留不變，isValidEmail 與 handleSubmit 驗證邏輯不動。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 重設計 StepClarify.tsx

**Files:**
- Modify: `src/app/q/[slug]/components/StepClarify.tsx`

- [ ] **Step 1: 替換內容**

```tsx
"use client";

import { useState } from "react";
import type { ClarificationItem } from "../lib/wizardTypes.ts";
import { StepProgress } from "./StepProgress.tsx";

/**
 * Wizard Step 3：一次回答本輪的所有反問（批次，FR-CL-1）。
 * 把當下缺漏的每一項各列一題、各給一個輸入框，客戶一輪填完一起送出。先前的
 * 描述由後端保留（answerFlow 以「原始描述 + 累積問答」重新解析），不需重述。
 * 若答完仍不完整，會再進下一輪（最多三輪）。
 */
type StepClarifyProps = {
  questions: readonly ClarificationItem[];
  submitting: boolean;
  serverError?: string;
  onSubmit: (answers: { field: string; answer: string }[]) => void;
};

export function StepClarify({
  questions,
  submitting,
  serverError,
  onSubmit,
}: StepClarifyProps) {
  // 以 targetField 為鍵收集各題答案。
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const allAnswered = questions.every(
    (item) => (answers[item.targetField] ?? "").trim().length > 0,
  );

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setTouched(true);
    if (!allAnswered) return;
    onSubmit(
      questions.map((item) => ({
        field: item.targetField,
        answer: (answers[item.targetField] ?? "").trim(),
      })),
    );
  }

  return (
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
        <p className="text-sm text-ink-soft">
          你先前的描述已經保留，請一次補齊下面這些問題就好。
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {questions.map((item, index) => {
          const value = answers[item.targetField] ?? "";
          const error = touched && value.trim().length === 0;
          const inputId = `clarify-answer-${item.targetField}`;
          return (
            <div key={item.targetField} className="flex flex-col gap-1.5">
              <label htmlFor={inputId} className="text-sm font-medium text-ink">
                {index + 1}. {item.question}
              </label>
              <input
                id={inputId}
                data-testid={`clarify-answer-${item.targetField}`}
                type="text"
                value={value}
                onChange={(event) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [item.targetField]: event.target.value,
                  }))
                }
                onBlur={() => setTouched(true)}
                disabled={submitting}
                aria-invalid={error}
                aria-describedby={error ? `${inputId}-error` : undefined}
                placeholder="用一句話回答即可"
                className="rounded-xl border border-surface-line px-4 py-3 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
              />
              {error && (
                <p id={`${inputId}-error`} role="alert" className="text-sm text-danger">
                  請回答這一題
                </p>
              )}
            </div>
          );
        })}

        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {serverError}
          </p>
        )}

        <button
          type="submit"
          data-testid="clarify-submit"
          disabled={submitting}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-6 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? "處理中…" : "送出回答"}
        </button>
      </form>
    </section>
  );
}
```

`data-testid="clarify-question"`、`data-testid={`clarify-answer-${item.targetField}`}`、`data-testid="clarify-submit"` 保持不變。`allAnswered`/`handleSubmit` 邏輯逐字不動。

- [ ] **Step 2: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/app/q/\[slug\]/components/StepClarify.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Step 3 反問補答套用新視覺 token（WBS 視覺重設計 Phase 2）

WHY：與 Task 4 相同規範，統一批次反問表單的視覺。

WHAT：與 StepDescribe 相同的輸入框/按鈕/錯誤文字樣式規範；文字「步驟 3/4」
改為 StepProgress。

IMPACT：純樣式變更，data-testid（clarify-question/clarify-answer-{field}/
clarify-submit）保留不變，allAnswered 與 handleSubmit 邏輯不動。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 重設計 StepResult.tsx

**Files:**
- Modify: `src/app/q/[slug]/components/StepResult.tsx`

- [ ] **Step 1: 替換內容**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { SessionStatus } from "@/shared/types/domain.types";
import { fetchStatus } from "../lib/wizardApi.ts";
import type { DescribeOutcome } from "../lib/wizardTypes.ts";
import { StepProgress } from "./StepProgress.tsx";

/**
 * Wizard Step 4：終態結果 + 狀態輪詢（FR-CW-3、FR-CW-4）。
 * 只處理終態：報價受理（帶 quote_code，含反問用盡的保守估算）／超出範圍轉人工。
 * 「仍需反問」不在此處——那由 StepClarify 在同一 session 內完成，客戶不需重述。
 */
type StepResultProps = {
  sessionId: string;
  outcome: DescribeOutcome;
  onRestart: () => void;
};

/** 狀態的中文顯示（面向客戶，不洩露金額）。 */
const STATUS_LABELS: Record<SessionStatus, string> = {
  created: "處理中…",
  parsing: "解析需求中…",
  awaiting_clarification: "等待補充資訊",
  pricing: "計算報價中…",
  awaiting_review: "等待商家確認中",
  confirmed: "報價已確認，準備寄送",
  sent: "報價單已寄出，請查收 email",
  abandoned: "此報價已取消",
};

const POLL_INTERVAL_MS = 5000;

export function StepResult({ sessionId, outcome, onRestart }: StepResultProps) {
  const isQuoteAccepted = Boolean(outcome.quoteCode);
  const [liveStatus, setLiveStatus] = useState<SessionStatus>(outcome.status);

  useEffect(() => {
    if (!isQuoteAccepted) return;

    let active = true;
    const timer = setInterval(async () => {
      const result = await fetchStatus(sessionId);
      if (active && result.ok) setLiveStatus(result.data.status);
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isQuoteAccepted, sessionId]);

  return (
    <section aria-labelledby="step-result-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <StepProgress current={4} />
        <h1 id="step-result-heading" className="text-2xl font-semibold tracking-tight text-ink">
          {isQuoteAccepted
            ? "已收到你的需求"
            : outcome.outOfScope
              ? "需要專人為你評估"
              : "處理中"}
        </h1>
      </header>

      {isQuoteAccepted && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-surface-line px-5 py-4">
            <p className="text-sm text-ink-soft">報價單編號</p>
            <p
              data-testid="result-quote-code"
              className="mt-1 font-mono text-lg font-semibold text-ink"
            >
              {outcome.quoteCode}
            </p>
          </div>
          {outcome.conservative && (
            <p className="text-sm text-ink-soft">
              此為依現有資訊做的初步估算，商家確認時會再依實際需求調整。
            </p>
          )}
          <p aria-live="polite" className="text-sm text-ink-soft">
            目前狀態：<span className="font-medium text-ink">{STATUS_LABELS[liveStatus]}</span>
            <br />
            商家確認後，報價單將以 email 寄送給你。
          </p>
        </div>
      )}

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
  );
}
```

`data-testid="result-quote-code"`、`data-testid="result-out-of-scope"` 保持不變。輪詢邏輯（`useEffect`/`fetchStatus`/`POLL_INTERVAL_MS`）逐字不動。

- [ ] **Step 2: 型別檢查與 lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: 無錯誤

- [ ] **Step 3: 執行完整測試套件**

Run: `pnpm test`
Expected: 全數通過（此為 Phase 2 最後一個檔案改動，跑全套作最終確認；基準為 Phase 1 結束時的 475 + Task 1 新增的 5 個 StepProgress 測試 = 480）

- [ ] **Step 4: Commit**

```bash
git add src/app/q/\[slug\]/components/StepResult.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Step 4 結果頁套用新視覺 token（WBS 視覺重設計 Phase 2）

WHY：完成 Phase 2 最後一個檔案，統一報價向導全五步驟視覺。

WHAT：報價單編號卡片邊框改 surface-line；狀態文字統一 ink-soft/ink；
「重新開始」連結 hover 態改 accent；文字「步驟 4/4」改為 StepProgress；
移除 dark: 變體。

IMPACT：純樣式變更，data-testid（result-quote-code/result-out-of-scope）
保留不變，輪詢邏輯（useEffect/fetchStatus/POLL_INTERVAL_MS）不動。
Phase 2（報價向導）全數完成。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Plan Self-Review 記錄

- **Placeholder 掃描**：無 TBD/TODO，所有程式碼區塊為完整可執行內容
- **Spec 覆蓋率**：Phase 2 spec 列出的 5 個檔案（WizardPage + 4 個 Step 元件）全數對應到 Task 2-6；「五步驟視覺一致性與進度感」需求由 Task 1 的 StepProgress 對應
- **E2E 選取器核對**：逐一比對 `tests/e2e/pages/CustomerWizardPage.ts` 依賴的 7 個 testid，全部在對應 Task 的程式碼區塊中原樣保留
- **一致性檢查**：三個表單類 Step（Describe/Clarify）採用與 Phase 1 完全相同的 input/button/error className 規範；圓角/focus 態/danger token 用法全站統一
- **邏輯零異動確認**：`WizardPage.tsx` 五個函式（`routeOutcome`/`startSession`/`handleSubmitDescribe`/`handleSubmitAnswer`/`handleRestart`）、`StepDescribe`/`StepClarify` 的驗證邏輯、`StepResult` 的輪詢 `useEffect`，皆與探索階段讀取的原始檔案逐字比對一致，僅 className 與新增的 `StepProgress` 呼叫
