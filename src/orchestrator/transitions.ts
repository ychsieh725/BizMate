import type { SessionStatus } from "@/shared/types/domain.types";
import type { SessionEvent } from "@/orchestrator/events.ts";

/**
 * 狀態轉移表（單一事實來源，SDS §4.2）。
 *
 * 結構：`TRANSITIONS[當前狀態][事件] = 下一狀態`。
 * 用巢狀查表取代 switch/if——非法轉移即「查無此鍵」，天然無特殊情況分支。
 * 終態（sent、abandoned）無出邊，故不列於表中。
 *
 * `timeout` 的「任一等待狀態 → abandoned」不寫成特例判斷，而是在三個等待狀態
 * （created、awaiting_clarification、awaiting_review）各自明確列出，
 * 讓「哪些狀態可逾時」由資料本身表達，而非藏在程式邏輯裡。
 */
export const TRANSITIONS: Readonly<
  Record<SessionStatus, Partial<Record<SessionEvent, SessionStatus>>>
> = {
  created: {
    describe_submitted: "parsing",
    timeout: "abandoned",
  },
  parsing: {
    parse_incomplete: "awaiting_clarification",
    parse_complete: "pricing",
  },
  awaiting_clarification: {
    answer_submitted: "parsing",
    clarification_exhausted: "pricing",
    timeout: "abandoned",
  },
  pricing: {
    pricing_done: "awaiting_review",
  },
  awaiting_review: {
    quote_confirmed: "confirmed",
    // 商家婉拒只在待審階段開放：一旦 confirmed 就已對客戶承諾，要反悔是
    // 另一種需通知客戶的行為，不與「還沒答應就回絕」共用同一個事件。
    quote_declined: "abandoned",
    timeout: "abandoned",
  },
  confirmed: {
    email_sent: "sent",
  },
  sent: {}, // 終態
  abandoned: {}, // 終態
};
