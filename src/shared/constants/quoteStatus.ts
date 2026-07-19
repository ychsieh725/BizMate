import type { QuoteStatus } from "@/shared/types/domain.types";

/** 報價狀態的中文顯示標籤（對應 DB enum quote_status）。 */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "草稿",
  awaiting_review: "待審",
  confirmed: "已確認",
  sent: "已寄出",
  // DB 值取 abandoned 是為了與 session_status 同名（見 migration 0008），
  // 但商家看到的語意是「我婉拒了這個案子」，故標籤不直譯為「已放棄」。
  abandoned: "已婉拒",
};

/** 供後台篩選 tab 依序渲染的狀態清單，並作為 zod enum 的值域來源。 */
export const QUOTE_STATUSES = [
  "draft",
  "awaiting_review",
  "confirmed",
  "sent",
  "abandoned",
] as const satisfies readonly QuoteStatus[];

/**
 * 報價列表「全部」視圖預設隱藏的狀態。
 * 婉拒等同從待處理清單移除，但資料保留可追溯——要查看時用狀態 tab 篩選。
 */
export const HIDDEN_BY_DEFAULT_STATUSES = [
  "abandoned",
] as const satisfies readonly QuoteStatus[];
