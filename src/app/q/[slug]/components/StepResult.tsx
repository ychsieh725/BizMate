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
