/**
 * 核心領域型別 —— 與 Supabase DB enum 一對一對應（SDS §3.1）。
 * 這是跨領域共用的穩定契約，各 domain 依此擴充，禁止各自重新定義。
 */

/** 案件類型（對應 DB enum case_category、PRD 附錄 A 三大類） */
export type CaseCategory = "graphic_design" | "illustration" | "web_design";

/**
 * Session 狀態機的八個狀態（對應 DB enum session_status）。
 * 多租戶重構後終審通路為網頁後台：舊 awaiting_freelancer 更名 awaiting_review，
 * LINE 時代的 revising 已淘汰（後台在 awaiting_review 下直接調整金額）。
 */
export type SessionStatus =
  | "created"
  | "parsing"
  | "awaiting_clarification"
  | "pricing"
  | "awaiting_review"
  | "confirmed"
  | "sent"
  | "abandoned";

/** 報價狀態（對應 DB enum quote_status） */
export type QuoteStatus =
  | "draft"
  | "awaiting_review"
  | "confirmed"
  | "sent"
  /** 商家婉拒（或未來的逾時）。與 SessionStatus 同名，讓 advance_quote_status
   *  單一 p_to_status 參數能同時 cast 成兩種 enum（見 migration 0008）。 */
  | "abandoned";

/** 商家（tenant 根，1:1 對應 auth.users；public_slug 即專屬報價連結 /q/{slug}） */
export type Merchant = {
  id: string;
  display_name: string;
  public_slug: string;
  contact_email: string;
  created_at: string;
  updated_at: string;
};

/** API 統一回應信封（patterns.md「一致的信封格式」） */
export type ApiResponse<TData> = {
  success: boolean;
  data: TData | null;
  error: string | null;
};
