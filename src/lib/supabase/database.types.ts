/**
 * Supabase 資料庫型別（手寫，對應 supabase/migrations/ 下的全部 migration）。
 * 形狀符合 @supabase/supabase-js 的 Database 泛型，讓 client.from() 得到型別安全查詢。
 * enum 從 shared/types 複用，避免重複定義（DRY）。
 *
 * **新增或修改資料表時，這裡必須同步更新。** 這份檔案是手寫而非 `supabase gen`
 * 產出，漏改不會有任何工具提醒：新表在此缺席時，`client.from("新表")` 會被
 * TypeScript 判為未知資料表而編譯失敗，症狀離根因很遠。agent_steps 就曾因
 * migration 0009 加了表卻沒同步此處，直到 A7 要讀它時才發現。
 */
import type {
  AgentStepStatus,
  CaseCategory,
  QuoteStatus,
  SessionStatus,
} from "@/shared/types/domain.types";

/** JSONB 欄位型別 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      merchants: {
        Row: {
          id: string;
          display_name: string;
          public_slug: string;
          contact_email: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          public_slug: string;
          contact_email: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          public_slug?: string;
          contact_email?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          merchant_id: string;
          category: CaseCategory;
          contact_email: string | null;
          status: SessionStatus;
          current_step: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          category: CaseCategory;
          contact_email?: string | null;
          status?: SessionStatus;
          current_step?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          category?: CaseCategory;
          contact_email?: string | null;
          status?: SessionStatus;
          current_step?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      raw_inputs: {
        Row: {
          id: string;
          session_id: string;
          raw_text: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          raw_text: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          raw_text?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      extracted_fields: {
        Row: {
          id: string;
          session_id: string;
          field_name: string;
          value: string | null;
          confidence: number | null;
          source_span: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          field_name: string;
          value?: string | null;
          confidence?: number | null;
          source_span?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          field_name?: string;
          value?: string | null;
          confidence?: number | null;
          source_span?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      clarification_turns: {
        Row: {
          id: string;
          session_id: string;
          round: number;
          question: string;
          answer: string | null;
          triggered_field: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          round: number;
          question: string;
          answer?: string | null;
          triggered_field: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          round?: number;
          question?: string;
          answer?: string | null;
          triggered_field?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      rate_card_base: {
        Row: {
          id: string;
          merchant_id: string;
          category: CaseCategory;
          subtype: string;
          unit: string;
          base_price: number | null;
          includes: string | null;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          category: CaseCategory;
          subtype: string;
          unit: string;
          base_price?: number | null;
          includes?: string | null;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          category?: CaseCategory;
          subtype?: string;
          unit?: string;
          base_price?: number | null;
          includes?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      rate_card_modifiers: {
        Row: {
          id: string;
          merchant_id: string;
          category: CaseCategory | null;
          modifier_name: string;
          trigger_condition: string;
          range_min: number | null;
          range_max: number | null;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          category?: CaseCategory | null;
          modifier_name: string;
          trigger_condition: string;
          range_min?: number | null;
          range_max?: number | null;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          category?: CaseCategory | null;
          modifier_name?: string;
          trigger_condition?: string;
          range_min?: number | null;
          range_max?: number | null;
        };
        Relationships: [];
      };
      rate_card_template_base: {
        Row: {
          id: string;
          category: CaseCategory;
          subtype: string;
          unit: string;
          base_price: number | null;
          includes: string | null;
        };
        Insert: {
          id?: string;
          category: CaseCategory;
          subtype: string;
          unit: string;
          base_price?: number | null;
          includes?: string | null;
        };
        Update: {
          id?: string;
          category?: CaseCategory;
          subtype?: string;
          unit?: string;
          base_price?: number | null;
          includes?: string | null;
        };
        Relationships: [];
      };
      rate_card_template_modifiers: {
        Row: {
          id: string;
          category: CaseCategory | null;
          modifier_name: string;
          trigger_condition: string;
          range_min: number | null;
          range_max: number | null;
        };
        Insert: {
          id?: string;
          category?: CaseCategory | null;
          modifier_name: string;
          trigger_condition: string;
          range_min?: number | null;
          range_max?: number | null;
        };
        Update: {
          id?: string;
          category?: CaseCategory | null;
          modifier_name?: string;
          trigger_condition?: string;
          range_min?: number | null;
          range_max?: number | null;
        };
        Relationships: [];
      };
      price_line_items: {
        Row: {
          id: string;
          session_id: string;
          item_name: string;
          amount: number;
          rule_id: string | null;
          modifier_id: string | null;
          agent_reasoning: string | null;
          confidence: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          item_name: string;
          amount: number;
          rule_id?: string | null;
          modifier_id?: string | null;
          agent_reasoning?: string | null;
          confidence?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          item_name?: string;
          amount?: number;
          rule_id?: string | null;
          modifier_id?: string | null;
          agent_reasoning?: string | null;
          confidence?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      quotes: {
        Row: {
          id: string;
          session_id: string;
          merchant_id: string;
          quote_code: string;
          final_amount: number | null;
          status: QuoteStatus;
          pdf_url: string | null;
          created_at: string;
          sent_at: string | null;
          is_conservative: boolean;
        };
        Insert: {
          id?: string;
          session_id: string;
          merchant_id: string;
          quote_code: string;
          final_amount?: number | null;
          status?: QuoteStatus;
          pdf_url?: string | null;
          created_at?: string;
          sent_at?: string | null;
          is_conservative?: boolean;
        };
        Update: {
          id?: string;
          session_id?: string;
          merchant_id?: string;
          quote_code?: string;
          final_amount?: number | null;
          status?: QuoteStatus;
          pdf_url?: string | null;
          created_at?: string;
          sent_at?: string | null;
          is_conservative?: boolean;
        };
        Relationships: [];
      };
      eval_runs: {
        Row: {
          id: string;
          run_id: string;
          dataset_version: string;
          metric_name: string;
          value: number | null;
          model_version: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          dataset_version: string;
          metric_name: string;
          value?: number | null;
          model_version?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          run_id?: string;
          dataset_version?: string;
          metric_name?: string;
          value?: number | null;
          model_version?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      cost_logs: {
        Row: {
          id: string;
          session_id: string | null;
          agent_name: string;
          model: string;
          input_tokens: number;
          output_tokens: number;
          cost_usd: number;
          latency_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          agent_name: string;
          model: string;
          input_tokens: number;
          output_tokens: number;
          cost_usd: number;
          latency_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          agent_name?: string;
          model?: string;
          input_tokens?: number;
          output_tokens?: number;
          cost_usd?: number;
          latency_ms?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_steps: {
        Row: {
          id: string;
          session_id: string;
          /** 同一次 agent loop 的所有 step 共用；一個 session 可跑多次 loop。 */
          run_id: string;
          step_index: number;
          tool_name: string;
          /** tool 的原始參數與回傳，供事後重建當時的決策情境。 */
          tool_args: Json | null;
          tool_result: Json | null;
          status: AgentStepStatus;
          error_detail: string | null;
          /** 純 DB 查詢與確定性計價不呼叫 LLM，故無對應 cost_logs 紀錄。 */
          cost_log_id: string | null;
          latency_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          run_id: string;
          step_index: number;
          tool_name: string;
          tool_args?: Json | null;
          tool_result?: Json | null;
          status: AgentStepStatus;
          error_detail?: string | null;
          cost_log_id?: string | null;
          latency_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          run_id?: string;
          step_index?: number;
          tool_name?: string;
          tool_args?: Json | null;
          tool_result?: Json | null;
          status?: AgentStepStatus;
          error_detail?: string | null;
          cost_log_id?: string | null;
          latency_ms?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          bucket_key: string;
          window_start: string;
          count: number;
        };
        Insert: {
          bucket_key: string;
          window_start: string;
          count?: number;
        };
        Update: {
          bucket_key?: string;
          window_start?: string;
          count?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      increment_rate_limit: {
        Args: {
          p_bucket_key: string;
          p_window_start: string;
          p_limit: number;
        };
        Returns: boolean;
      };
      advance_quote_status: {
        Args: {
          p_quote_id: string;
          p_merchant_id: string;
          p_from_status: string;
          p_to_status: string;
          p_set_sent_at: boolean;
        };
        Returns: boolean;
      };
      adjust_quote_amount: {
        Args: {
          p_quote_id: string;
          p_merchant_id: string;
          p_new_amount: number;
          p_from_status: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      case_category: CaseCategory;
      session_status: SessionStatus;
      quote_status: QuoteStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};

/** 便捷別名：取某張表的 Row / Insert / Update 型別 */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
