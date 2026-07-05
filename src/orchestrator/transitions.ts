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
 * （created、awaiting_clarification、awaiting_freelancer）各自明確列出，
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
    pricing_done: "awaiting_freelancer",
  },
  awaiting_freelancer: {
    line_received: "revising",
    timeout: "abandoned",
  },
  revising: {
    revision_applied: "awaiting_freelancer",
    revision_confirmed: "confirmed",
  },
  confirmed: {
    email_sent: "sent",
  },
  sent: {}, // 終態
  abandoned: {}, // 終態
};
