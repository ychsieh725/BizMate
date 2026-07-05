import { describe, it, expect } from "vitest";
import type { SessionStatus } from "@/shared/types/domain.types";
import type { SessionEvent } from "@/orchestrator/events.ts";
import {
  transition,
  canTransition,
  isTerminalState,
  availableEvents,
} from "@/orchestrator/stateMachine.ts";

/**
 * 期望的合法轉移清單，直接依 SDS §4.2 手寫，**獨立於** transitions.ts。
 * 作為第二事實來源：若實作的轉移表被改錯，這裡能抓到偏差。
 */
const EXPECTED_TRANSITIONS: ReadonlyArray<
  [SessionStatus, SessionEvent, SessionStatus]
> = [
  ["created", "describe_submitted", "parsing"],
  ["created", "timeout", "abandoned"],
  ["parsing", "parse_incomplete", "awaiting_clarification"],
  ["parsing", "parse_complete", "pricing"],
  ["awaiting_clarification", "answer_submitted", "parsing"],
  ["awaiting_clarification", "clarification_exhausted", "pricing"],
  ["awaiting_clarification", "timeout", "abandoned"],
  ["pricing", "pricing_done", "awaiting_freelancer"],
  ["awaiting_freelancer", "line_received", "revising"],
  ["awaiting_freelancer", "timeout", "abandoned"],
  ["revising", "revision_applied", "awaiting_freelancer"],
  ["revising", "revision_confirmed", "confirmed"],
  ["confirmed", "email_sent", "sent"],
];

const ALL_STATES: readonly SessionStatus[] = [
  "created",
  "parsing",
  "awaiting_clarification",
  "pricing",
  "awaiting_freelancer",
  "revising",
  "confirmed",
  "sent",
  "abandoned",
];

const ALL_EVENTS: readonly SessionEvent[] = [
  "describe_submitted",
  "parse_incomplete",
  "parse_complete",
  "answer_submitted",
  "clarification_exhausted",
  "pricing_done",
  "line_received",
  "revision_applied",
  "revision_confirmed",
  "email_sent",
  "timeout",
];

const TERMINAL_STATES: readonly SessionStatus[] = ["sent", "abandoned"];

describe("transition — 合法轉移", () => {
  it.each(EXPECTED_TRANSITIONS)(
    "%s + %s → %s",
    (from, event, expected) => {
      const result = transition(from, event);
      expect(result).toEqual({ ok: true, state: expected });
    },
  );
});

describe("transition — 非法轉移", () => {
  // 所有 (狀態 × 事件) 組合中，不在期望清單內者皆應為非法
  const legalKeys = new Set(
    EXPECTED_TRANSITIONS.map(([from, event]) => `${from}::${event}`),
  );
  const illegalPairs: [SessionStatus, SessionEvent][] = [];
  for (const state of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      if (!legalKeys.has(`${state}::${event}`)) {
        illegalPairs.push([state, event]);
      }
    }
  }

  it.each(illegalPairs)("%s + %s → 拒絕", (from, event) => {
    const result = transition(from, event);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(from);
      expect(result.error).toContain(event);
    }
  });

  it("終態不接受任何事件", () => {
    for (const state of TERMINAL_STATES) {
      for (const event of ALL_EVENTS) {
        expect(transition(state, event).ok).toBe(false);
      }
    }
  });
});

describe("canTransition", () => {
  it("合法組合回傳 true", () => {
    for (const [from, event] of EXPECTED_TRANSITIONS) {
      expect(canTransition(from, event)).toBe(true);
    }
  });

  it("非法組合回傳 false", () => {
    expect(canTransition("parsing", "timeout")).toBe(false);
    expect(canTransition("sent", "email_sent")).toBe(false);
    expect(canTransition("created", "pricing_done")).toBe(false);
  });
});

describe("isTerminalState", () => {
  it("sent 與 abandoned 為終態", () => {
    expect(isTerminalState("sent")).toBe(true);
    expect(isTerminalState("abandoned")).toBe(true);
  });

  it("其餘狀態非終態", () => {
    for (const state of ALL_STATES) {
      if (!TERMINAL_STATES.includes(state)) {
        expect(isTerminalState(state)).toBe(false);
      }
    }
  });
});

describe("availableEvents", () => {
  it("列出該狀態所有合法事件", () => {
    expect([...availableEvents("created")].sort()).toEqual(
      ["describe_submitted", "timeout"].sort(),
    );
    expect([...availableEvents("revising")].sort()).toEqual(
      ["revision_applied", "revision_confirmed"].sort(),
    );
  });

  it("終態回傳空陣列", () => {
    expect(availableEvents("sent")).toEqual([]);
    expect(availableEvents("abandoned")).toEqual([]);
  });

  it("回傳事件皆能成功轉移", () => {
    for (const state of ALL_STATES) {
      for (const event of availableEvents(state)) {
        expect(transition(state, event).ok).toBe(true);
      }
    }
  });
});
