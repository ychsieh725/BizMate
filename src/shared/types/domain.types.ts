/**
 * 核心領域型別 —— 與 Supabase DB enum 一對一對應（SDS §3.1）。
 * 這是跨領域共用的穩定契約，各 domain 依此擴充，禁止各自重新定義。
 */

/** 案件類型（對應 DB enum case_category、PRD 附錄 A 三大類） */
export type CaseCategory = "graphic_design" | "illustration" | "web_design";

/** Session 狀態機的九個狀態（對應 DB enum session_status、SDS §4.1） */
export type SessionStatus =
  | "created"
  | "parsing"
  | "awaiting_clarification"
  | "pricing"
  | "awaiting_freelancer"
  | "revising"
  | "confirmed"
  | "sent"
  | "abandoned";

/** 報價狀態（對應 DB enum quote_status、SDS §3.4） */
export type QuoteStatus = "draft" | "awaiting_freelancer" | "confirmed" | "sent";

/** LINE 修改來源通道（對應 DB enum revision_channel、SDS §3.4） */
export type RevisionChannel = "line_text" | "line_postback";

/** API 統一回應信封（patterns.md「一致的信封格式」） */
export type ApiResponse<TData> = {
  success: boolean;
  data: TData | null;
  error: string | null;
};
