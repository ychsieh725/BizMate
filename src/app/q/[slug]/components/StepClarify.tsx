"use client";

import { useState } from "react";
import type { ClarificationItem } from "../lib/wizardTypes.ts";

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
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          步驟 3 / 4
        </p>
        <h1 id="step-clarify-heading" className="text-2xl font-semibold tracking-tight">
          還差幾項資訊
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
              <label htmlFor={inputId} className="text-sm font-medium">
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
                className="rounded-2xl border border-black/[.08] px-4 py-3 text-base outline-none focus-visible:border-foreground/60 disabled:opacity-50 dark:border-white/[.145]"
              />
              {error && (
                <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
                  請回答這一題
                </p>
              )}
            </div>
          );
        })}

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
