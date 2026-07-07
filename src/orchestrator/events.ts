/**
 * Session 狀態機的觸發事件。
 *
 * 設計：每筆轉移都是「一狀態 + 一事件 → 一狀態」，無複合跳轉、無特殊情況。
 * 多租戶重構後終審通路為網頁後台：LINE 時代的 line_received / revision_applied /
 * revision_confirmed 淘汰，收斂為單一 quote_confirmed（後台在 awaiting_review
 * 下直接調整金額，不需獨立修訂狀態）。
 */
export type SessionEvent =
  | "describe_submitted" // created → parsing
  | "parse_incomplete" // parsing → awaiting_clarification
  | "parse_complete" // parsing → pricing
  | "answer_submitted" // awaiting_clarification → parsing（重新抽取）
  | "clarification_exhausted" // awaiting_clarification → pricing（fallback 保守估價）
  | "pricing_done" // pricing → awaiting_review
  | "quote_confirmed" // awaiting_review → confirmed（商家後台終審）
  | "email_sent" // confirmed → sent
  | "timeout"; // 任一等待狀態 → abandoned
