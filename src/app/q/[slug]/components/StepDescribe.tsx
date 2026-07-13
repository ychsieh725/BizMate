"use client";

import { useState } from "react";

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
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          步驟 2 / 4 · {categoryLabel}
        </p>
        <h1 id="step-describe-heading" className="text-2xl font-semibold tracking-tight">
          用你的話描述需求
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          越具體越好：用途、數量、交期、預算、修改次數等。
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="raw-text" className="text-sm font-medium">
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
            placeholder="例：我想要一張 A2 尺寸的活動海報，商業用途，兩週內完成，希望能修改兩次。"
            className="resize-y rounded-2xl border border-black/[.08] px-4 py-3 text-base outline-none focus-visible:border-foreground/60 disabled:opacity-50 dark:border-white/[.145]"
          />
          {touched && rawTextError && (
            <p id="raw-text-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {rawTextError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-email" className="text-sm font-medium">
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
            className="rounded-2xl border border-black/[.08] px-4 py-3 text-base outline-none focus-visible:border-foreground/60 disabled:opacity-50 dark:border-white/[.145]"
          />
          {touched && emailError && (
            <p id="contact-email-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {emailError}
            </p>
          )}
        </div>

        {serverError && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {serverError}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            className="h-12 rounded-full border border-black/[.08] px-5 text-sm font-medium transition-colors hover:bg-black/[.02] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.04]"
          >
            ← 上一步
          </button>
          <button
            type="submit"
            data-testid="describe-submit"
            disabled={submitting}
            className="inline-flex h-12 flex-1 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "解析中…" : "送出需求"}
          </button>
        </div>
      </form>
    </section>
  );
}
