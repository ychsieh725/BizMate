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
