import type { SessionStatus } from "@/shared/types/domain.types";
import type { SessionEvent } from "@/orchestrator/events.ts";
import { TRANSITIONS } from "@/orchestrator/transitions.ts";

/**
 * 轉移結果。非法轉移以 Result 型別回傳而非 throw——狀態機不該用例外控制流程，
 * 讓呼叫端（3.2 API 層）能以型別安全的方式分流成功/失敗。
 */
export type TransitionResult =
  | { readonly ok: true; readonly state: SessionStatus }
  | { readonly ok: false; readonly error: string };

/** 依當前狀態與事件查表，回傳下一狀態或明確錯誤（純函式，無副作用）。 */
export function transition(
  current: SessionStatus,
  event: SessionEvent,
): TransitionResult {
  const next = TRANSITIONS[current][event];
  if (next === undefined) {
    return {
      ok: false,
      error: `非法轉移：狀態 ${current} 不接受事件 ${event}`,
    };
  }
  return { ok: true, state: next };
}

/** 該狀態遇到該事件是否為合法轉移。 */
export function canTransition(
  current: SessionStatus,
  event: SessionEvent,
): boolean {
  return TRANSITIONS[current][event] !== undefined;
}

/** 是否為終態（無任何出邊）。 */
export function isTerminalState(state: SessionStatus): boolean {
  return Object.keys(TRANSITIONS[state]).length === 0;
}

/** 該狀態下所有合法事件（供 UI/除錯列舉，順序不保證）。 */
export function availableEvents(state: SessionStatus): SessionEvent[] {
  return Object.keys(TRANSITIONS[state]) as SessionEvent[];
}
