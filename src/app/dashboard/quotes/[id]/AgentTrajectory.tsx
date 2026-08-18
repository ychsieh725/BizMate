import {
  AGENT_RUN_OUTCOME_LABELS,
  AGENT_STEP_STATUS_LABELS,
  agentToolLabel,
} from "@/shared/constants/agentTools.ts";
import type { AgentStepStatus } from "@/shared/types/domain.types";
import {
  groupStepsIntoRuns,
  runOutcome,
  type AgentRunOutcome,
  type AgentStep,
} from "@/domains/pricing/agentTrajectory.ts";

/**
 * agent 決策軌跡（A7）。
 *
 * 這個區塊回答的是「AI 為什麼給出這個數字」。既有的「抽取欄位」只顯示結論
 * （抽到什麼），軌跡顯示的是過程（先查了價目表、記了欄位、然後決定出價還是
 * 反問），兩者互補。
 *
 * ## 為什麼用 details 而非 useState
 *
 * 展開／收合是瀏覽器原生行為，用 `<details>` 就不必把整棵子樹變成 Client
 * Component。少一份送到瀏覽器的 JS，且鍵盤操作與螢幕閱讀器支援是原生的，
 * 不需要自己補 aria-expanded。
 *
 * ## 空狀態是常態，不是例外
 *
 * `AGENT_LOOP_ENABLED` 預設關閉（A6 的量測結論是暫不開啟），因此目前每一張
 * 報價的軌跡都會是空的。空狀態必須說清楚「沒跑」而不是「跑了但沒東西」，
 * 否則商家會以為系統壞了。
 */

const STEP_STATUS_STYLE: Record<AgentStepStatus, string> = {
  ok: "bg-status-sent-bg text-status-sent-fg",
  // 參數不合規是護欄生效、agent 隨後修正，用提醒色而非錯誤色
  rejected: "bg-status-review-bg text-status-review-fg",
  error: "bg-danger-soft text-danger",
  fallback: "bg-surface-line text-ink-soft",
};

const RUN_OUTCOME_STYLE: Record<AgentRunOutcome, string> = {
  completed: "bg-status-sent-bg text-status-sent-fg",
  fallback: "bg-surface-line text-ink-soft",
  error: "bg-danger-soft text-danger",
};

/** 毫秒轉成人看得懂的秒數；未記錄時回 null 讓呼叫端決定怎麼顯示。 */
function formatLatency(ms: number | null): string | null {
  if (ms === null) {
    return null;
  }
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** JSONB 欄位的顯示；null 與空物件都視為無內容。 */
function formatPayload(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "object" && Object.keys(value).length === 0) {
    return null;
  }
  return JSON.stringify(value, null, 2);
}

function StepDetail({ label, payload }: { label: string; payload: unknown }) {
  const formatted = formatPayload(payload);
  if (formatted === null) {
    return null;
  }
  return (
    <div className="mt-2">
      <p className="text-ink-faint">{label}</p>
      <pre className="text-ink-soft mt-1 overflow-x-auto rounded-lg bg-surface-line/40 p-2 font-mono text-[11px] leading-relaxed">
        {formatted}
      </pre>
    </div>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  const latency = formatLatency(step.latency_ms);
  const hasDetail =
    formatPayload(step.tool_args) !== null ||
    formatPayload(step.tool_result) !== null ||
    step.error_detail !== null;

  const header = (
    <>
      <span className="text-ink-faint font-mono tabular-nums">
        {step.step_index + 1}
      </span>
      <span className="text-ink-soft">{agentToolLabel(step.tool_name)}</span>
      <code className="text-ink-faint text-[11px]">{step.tool_name}</code>
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] ${STEP_STATUS_STYLE[step.status]}`}
      >
        {AGENT_STEP_STATUS_LABELS[step.status]}
      </span>
      {latency !== null && (
        <span className="text-ink-faint ml-auto font-mono tabular-nums">{latency}</span>
      )}
    </>
  );

  if (!hasDetail) {
    // 沒有可展開的內容時不給 details，避免點了沒反應
    return (
      <li className="border-surface-line border-t first:border-t-0">
        <div className="flex flex-wrap items-center gap-2 py-2">{header}</div>
      </li>
    );
  }

  return (
    <li className="border-surface-line border-t first:border-t-0">
      <details className="group">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 py-2 marker:content-['']">
          {header}
          <span className="text-ink-faint text-[11px] group-open:hidden">展開</span>
          <span className="text-ink-faint hidden text-[11px] group-open:inline">收合</span>
        </summary>
        <div className="pb-3 pl-4">
          {step.error_detail !== null && (
            <p className="text-danger mt-2">{step.error_detail}</p>
          )}
          <StepDetail label="參數" payload={step.tool_args} />
          <StepDetail label="回傳" payload={step.tool_result} />
        </div>
      </details>
    </li>
  );
}

export function AgentTrajectory({ steps }: { steps: readonly AgentStep[] }) {
  const runs = groupStepsIntoRuns(steps);

  return (
    <section className="border-surface-line bg-surface shadow-card flex flex-col gap-2 rounded-2xl border p-5 text-xs">
      <h2 className="text-ink-soft font-medium">AI 決策軌跡</h2>

      {runs.length === 0 ? (
        <p className="text-ink-faint">
          此報價未經 agent 處理，走的是單步解析流程。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map((run) => {
            const outcome = runOutcome(run);
            const total = formatLatency(run.totalLatencyMs);
            return (
              <div
                key={run.runId}
                className="border-surface-line rounded-xl border px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-soft">第 {run.attempt} 次執行</span>
                  <span className="text-ink-faint">{run.steps.length} 步</span>
                  {total !== null && (
                    <span className="text-ink-faint font-mono tabular-nums">{total}</span>
                  )}
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${RUN_OUTCOME_STYLE[outcome]}`}
                  >
                    {AGENT_RUN_OUTCOME_LABELS[outcome]}
                  </span>
                </div>
                <ol className="mt-1">
                  {run.steps.map((step) => (
                    <StepRow key={step.id} step={step} />
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
