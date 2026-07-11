import type { QuoteStatus } from "@/shared/types/domain.types";

/** 報價狀態的中文顯示標籤（對應 DB enum quote_status）。 */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "草稿",
  awaiting_review: "待審",
  confirmed: "已確認",
  sent: "已寄出",
};

/** 供後台篩選 tab 依序渲染的狀態清單，並作為 zod enum 的值域來源。 */
export const QUOTE_STATUSES = [
  "draft",
  "awaiting_review",
  "confirmed",
  "sent",
] as const satisfies readonly QuoteStatus[];
