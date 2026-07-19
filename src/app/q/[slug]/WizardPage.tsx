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
