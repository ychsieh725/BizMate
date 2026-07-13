import type { QuoteStatus } from "@/shared/types/domain.types";

const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: "bg-surface-line text-ink-soft",
  awaiting_review: "bg-status-review-bg text-status-review-fg",
  confirmed: "bg-status-confirmed-bg text-status-confirmed-fg",
  sent: "bg-status-sent-bg text-status-sent-fg",
};

/** 狀態 → Tailwind class 的對照，抽成純函式以利獨立測試。 */
export function statusPillClassName(status: QuoteStatus): string {
  return `rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLE[status]}`;
}

export function StatusPill({
  status,
  label,
}: {
  status: QuoteStatus;
  label: string;
}) {
  return <span className={statusPillClassName(status)}>{label}</span>;
}
