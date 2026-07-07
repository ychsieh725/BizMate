"use client";

import { useState } from "react";
import Link from "next/link";
import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { createSession, submitDescribe } from "./lib/wizardApi.ts";
import type { DescribeOutcome, WizardStep } from "./lib/wizardTypes.ts";
import { StepCategory } from "./components/StepCategory.tsx";
import { StepDescribe } from "./components/StepDescribe.tsx";
import { StepResult } from "./components/StepResult.tsx";

/**
 * Wizard 容器（任務 3.6）：編排 Step 1-4 的狀態流轉（FR-CW-1~4）。
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
  const [serverError, setServerError] = useState<string>("");

  /** Step 1→2：建立 session 後進入描述步驟（同一類型可重用於「重新描述」）。 */
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

  /** Step 2→4：送出描述，依 outcome 進結果頁；失敗留在描述步驟。 */
  async function handleSubmitDescribe(input: {
    rawText: string;
    contactEmail: string;
  }): Promise<void> {
    if (!sessionId) return;
    setServerError("");
    setStep("submitting");
    const result = await submitDescribe(sessionId, input);
    if (!result.ok) {
      setServerError(result.error);
      setStep("describe");
      return;
    }
    setOutcome(result.data);
    setStep("result");
  }

  /** 完全重置，回到類型選擇。 */
  function handleRestart(): void {
    setStep("category");
    setCategory(null);
    setSessionId(null);
    setOutcome(null);
    setServerError("");
  }

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <header className="text-sm font-medium text-zinc-500">
        {merchantName} 的自動報價
      </header>
      {step === "category" && (
        <>
          <StepCategory onSelect={startSession} />
          {serverError && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {serverError}
            </p>
          )}
          <Link
            href={PAGE_ROUTES.home}
            className="text-sm font-medium text-zinc-500 underline underline-offset-4 hover:text-foreground"
          >
            ← 回首頁
          </Link>
        </>
      )}

      {(step === "describe" || step === "submitting") && category && (
        <StepDescribe
          categoryLabel={CASE_CATEGORY_LABELS[category]}
          submitting={step === "submitting"}
          serverError={serverError || undefined}
          onSubmit={handleSubmitDescribe}
          onBack={handleRestart}
        />
      )}

      {step === "result" && sessionId && outcome && (
        <StepResult
          sessionId={sessionId}
          outcome={outcome}
          onRestart={handleRestart}
          onBackToDescribe={() => category && startSession(category)}
        />
      )}
    </main>
  );
}
