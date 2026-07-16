"use client";

import { useState } from "react";

/**
 * Wizard Step 3：回答系統的單題反問（FR-CL-1）。
 * 客戶只需回答這一題，先前的描述由後端保留（answerFlow 以「原始描述 + 累積
 * 問答」重新解析），不需要重述需求——這正是修掉「反問即從頭再來」的關鍵。
 */
type StepClarifyProps = {
  question: string;
  submitting: boolean;
  serverError?: string;
  onSubmit: (answer: string) => void;
};

export function StepClarify({
  question,
  submitting,
  serverError,
  onSubmit,
}: StepClarifyProps) {
  const [answer, setAnswer] = useState("");
  const [touched, setTouched] = useState(false);

  const answerError = answer.trim().length === 0 ? "請回答上面的問題" : "";

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setTouched(true);
    if (answerError !== "") return;
    onSubmit(answer.trim());
  }

  return (
    <section aria-labelledby="step-clarify-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          步驟 3 / 4
        </p>
        <h1 id="step-clarify-heading" className="text-2xl font-semibold tracking-tight">
          還差一點資訊
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          你先前的描述已經保留，只要回答下面這一題就好。
        </p>
      </header>

      <p
        data-testid="clarify-question"
        className="rounded-2xl border border-black/[.08] bg-black/[.02] px-5 py-4 text-base font-medium dark:border-white/[.145] dark:bg-white/[.03]"
      >
        {question}
      </p>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="clarify-answer" className="text-sm font-medium">
            你的回答
          </label>
          <textarea
            id="clarify-answer"
            data-testid="clarify-answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            disabled={submitting}
            aria-invalid={touched && answerError !== ""}
            aria-describedby={answerError ? "clarify-answer-error" : undefined}
            placeholder="用一句話回答即可"
            className="resize-y rounded-2xl border border-black/[.08] px-4 py-3 text-base outline-none focus-visible:border-foreground/60 disabled:opacity-50 dark:border-white/[.145]"
          />
          {touched && answerError && (
            <p id="clarify-answer-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {answerError}
            </p>
          )}
        </div>

        {serverError && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {serverError}
          </p>
        )}

        <button
          type="submit"
          data-testid="clarify-submit"
          disabled={submitting}
          className="inline-flex h-12 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "處理中…" : "送出回答"}
        </button>
      </form>
    </section>
  );
}
