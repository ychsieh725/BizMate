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
