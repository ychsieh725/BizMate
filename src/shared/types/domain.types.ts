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

/**
 * agent loop 中單一 step 的結局（對應 migration 0009 的 agent_step_status enum，
 * 以及 Python 端 `app/db/repositories/agent_steps.py` 的同名 Literal）。
 *
 * 三份定義必須一致：Python 寫入、PostgreSQL 約束、TypeScript 讀取。
 * 任一邊多出或少掉一個值，症狀都是後台軌跡顯示不出來而非查詢報錯。
 */
export type AgentStepStatus =
  /** tool 正常執行完成。 */
  | "ok"
  /** 參數不合 schema 或欄位不在白名單，已回錯誤讓 agent 重試（不終止 loop）。 */
  | "rejected"
  /** tool 執行時拋錯，含 LLM 呼叫失敗。 */
  | "error"
  /** 預算用盡或偵測到迴圈，該步為退回既有路徑的標記。 */
  | "fallback";

/**
 * 商家在售的一項服務（供 Parser 作為 subtype 值域與數量語意的依據）。
 *
 * unit 是**計價單位**，決定了「數量 1」代表什麼。少了它，模型無法判斷
 * 「一組貼圖，八款」的數量是 1 還是 8——A6 實測即因此把該案例算成 8 倍價。
 * 單位隨商家而異（有人按組賣貼圖、有人按款賣），故不能寫死在 prompt 裡。
 *
 * 放在 shared 而非 pricing domain：intake 需要它，但 parserAgent 刻意不依賴
 * pricing domain（跨域組裝是 orchestrator 的職責）。
 */
export type RateCardService = {
  subtype: string;
  unit: string;
};

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
