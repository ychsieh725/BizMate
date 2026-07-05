/**
 * Session 狀態機的觸發事件（SDS §4.2 轉移表萃取）。
 *
 * 設計：SDS 表中「revising 確認 → confirmed → sent」的複合跳轉，在此拆為
 * 兩個單一事件（revision_confirmed、email_sent），使每筆轉移都是
 * 「一狀態 + 一事件 → 一狀態」，無複合跳轉、無特殊情況。
 */
export type SessionEvent =
  | "describe_submitted" // created → parsing
  | "parse_incomplete" // parsing → awaiting_clarification
  | "parse_complete" // parsing → pricing
  | "answer_submitted" // awaiting_clarification → parsing（重新抽取）
  | "clarification_exhausted" // awaiting_clarification → pricing（fallback 保守估價）
  | "pricing_done" // pricing → awaiting_freelancer
  | "line_received" // awaiting_freelancer → revising
  | "revision_applied" // revising → awaiting_freelancer（迴圈）
  | "revision_confirmed" // revising → confirmed
  | "email_sent" // confirmed → sent
  | "timeout"; // 任一等待狀態 → abandoned
