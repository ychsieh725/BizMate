import type { Tables } from "@/lib/supabase/database.types.ts";
import type { CaseCategory, QuoteStatus } from "@/shared/types/domain.types";

/**
 * 後台列表的一列：quotes 本體 + 該 session 的 category / 客戶 email。
 * category/contact_email 可能為 null（FK 保證 session 必存在，但防禦式建模：
 * 資料不一致時列表仍能渲染，不整頁爆掉）。
 */
export type QuoteListRow = {
  id: string;
  quote_code: string;
  final_amount: number | null;
  status: QuoteStatus;
  is_conservative: boolean;
  created_at: string;
  category: CaseCategory | null;
  contact_email: string | null;
};

/** 後台詳情：一張報價的完整可追溯脈絡。 */
export type QuoteDetail = {
  quote: Tables<"quotes">;
  session: Tables<"sessions">;
  lineItems: Tables<"price_line_items">[];
  extractedFields: Tables<"extracted_fields">[];
  clarifications: Tables<"clarification_turns">[];
  rawInputs: Tables<"raw_inputs">[];
  /** agent 決策軌跡。flag 關閉時為空陣列，非 null——「沒跑過」不是錯誤狀態。 */
  agentSteps: Tables<"agent_steps">[];
};
