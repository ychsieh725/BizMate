"use client";

import { useEffect, useState } from "react";
import type { SessionStatus } from "@/shared/types/domain.types";
import { fieldLabel } from "@/shared/constants/fieldLabels.ts";
import { fetchStatus } from "../lib/wizardApi.ts";
import type { DescribeOutcome } from "../lib/wizardTypes.ts";

/**
 * Wizard Step 3/4：送出結果 + 狀態輪詢（FR-CW-3、FR-CW-4）。
 * 三種結局：報價受理（帶 quote_code）／缺欄位提示／超出範圍轉人工。
 * 僅「已受理」情境啟動輪詢，讓客戶看到接案者終審進度。
 */
type StepResultProps = {
  sessionId: string;
  outcome: DescribeOutcome;
  onRestart: () => void;
  onBackToDescribe: () => void;
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

export function StepResult({
  sessionId,
  outcome,
  onRestart,
  onBackToDescribe,
}: StepResultProps) {
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
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          步驟 4 / 4
        </p>
        <h1 id="step-result-heading" className="text-2xl font-semibold tracking-tight">
          {isQuoteAccepted
            ? "已收到你的需求"
            : outcome.outOfScope
              ? "需要專人為你評估"
              : "還差一點資訊"}
        </h1>
      </header>

      {isQuoteAccepted && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-black/[.08] px-5 py-4 dark:border-white/[.145]">
            <p className="text-sm text-zinc-500">報價單編號</p>
            <p className="mt-1 font-mono text-lg font-semibold">{outcome.quoteCode}</p>
          </div>
          <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
            目前狀態：<span className="font-medium text-foreground">{STATUS_LABELS[liveStatus]}</span>
            <br />
            商家確認後，報價單將以 email 寄送給你。
          </p>
        </div>
      )}

      {!isQuoteAccepted && outcome.missingFields && outcome.missingFields.length > 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            為了給你準確報價，還需要補充以下資訊：
          </p>
          <ul className="flex flex-wrap gap-2">
            {outcome.missingFields.map((field) => (
              <li
                key={field}
                className="rounded-full border border-amber-300 bg-amber-50 px-4 py-1.5 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300"
              >
                {fieldLabel(field)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onBackToDescribe}
            className="inline-flex h-12 w-fit items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            補充後重新描述
          </button>
        </div>
      )}

      {!isQuoteAccepted && outcome.outOfScope && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          你的需求超出標準報價範圍，我們已轉由專人評估，將盡快與你聯繫。
        </p>
      )}

      <button
        type="button"
        onClick={onRestart}
        className="text-sm font-medium text-zinc-500 underline underline-offset-4 hover:text-foreground"
      >
        重新開始一筆新報價
      </button>
    </section>
  );
}
