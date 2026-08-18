import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";
import type { QuoteStatus } from "@/shared/types/domain.types";
import { HIDDEN_BY_DEFAULT_STATUSES } from "@/shared/constants/quoteStatus.ts";

/**
 * 後台報價審核的唯讀查詢 repository（5.6）。
 * 與既有 quotesRepository（報價寫入 + quote_code 流水號）分開——
 * 「報價產生」與「後台審核」是不同關注點（比照 rateCardRepository vs
 * servicesRepository 的切分）。
 *
 * ⚠ 安全約定：以 sessionId 為參數的四個子表方法只能由 quoteReviewService
 * 在完成 quote 歸屬檢查之後呼叫。price_line_items / extracted_fields /
 * clarification_turns / raw_inputs 沒有 merchant_id，自身無法判斷租戶歸屬，
 * 且本 client 走 service_role 繞過 RLS。
 */
export class QuoteReviewRepository extends BaseRepository<"quotes"> {
  constructor() {
    super("quotes");
  }

  /**
   * 該商家的報價，status 選填過濾，依建立時間新到舊。
   * 未指定 status（「全部」視圖）時排除 HIDDEN_BY_DEFAULT_STATUSES——
   * 婉拒的報價等同已從待處理清單移除，但仍可用狀態 tab 明確篩出。
   */
  async findByMerchant(
    merchantId: string,
    status?: QuoteStatus,
  ): Promise<Tables<"quotes">[]> {
    const byMerchant = this.client
      .from("quotes")
      .select("*")
      .eq("merchant_id", merchantId);
    const filtered =
      status === undefined
        ? byMerchant.not(
            "status",
            "in",
            `(${HIDDEN_BY_DEFAULT_STATUSES.join(",")})`,
          )
        : byMerchant.eq("status", status);

    const { data, error } = await filtered.order("created_at", {
      ascending: false,
    });
    if (error) {
      throw new RepositoryError("quotes", "findByMerchant", error.message);
    }
    return data ?? [];
  }

  /** 依 id 批次取 sessions（列表需顯示 category / 客戶 email）。 */
  async findSessionsByIds(ids: string[]): Promise<Tables<"sessions">[]> {
    if (ids.length === 0) return [];

    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .in("id", ids);
    if (error) {
      throw new RepositoryError("sessions", "findSessionsByIds", error.message);
    }
    return data ?? [];
  }

  /** 單一 session（詳情頁的案件本體）。 */
  async findSessionById(sessionId: string): Promise<Tables<"sessions"> | null> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) {
      throw new RepositoryError("sessions", "findSessionById", error.message);
    }
    return data ?? null;
  }

  /** 費用明細，依建立順序。 */
  async findLineItems(
    sessionId: string,
  ): Promise<Tables<"price_line_items">[]> {
    const { data, error } = await this.client
      .from("price_line_items")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "price_line_items",
        "findLineItems",
        error.message,
      );
    }
    return data ?? [];
  }

  /** 抽取欄位，依欄位名穩定排序（不隨 upsert 順序跳動）。 */
  async findExtractedFields(
    sessionId: string,
  ): Promise<Tables<"extracted_fields">[]> {
    const { data, error } = await this.client
      .from("extracted_fields")
      .select("*")
      .eq("session_id", sessionId)
      .order("field_name", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "extracted_fields",
        "findExtractedFields",
        error.message,
      );
    }
    return data ?? [];
  }

  /** 澄清歷程（含未回答的最後一輪），依輪次遞增。 */
  async findClarifications(
    sessionId: string,
  ): Promise<Tables<"clarification_turns">[]> {
    const { data, error } = await this.client
      .from("clarification_turns")
      .select("*")
      .eq("session_id", sessionId)
      .order("round", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "clarification_turns",
        "findClarifications",
        error.message,
      );
    }
    return data ?? [];
  }

  /**
   * agent 決策軌跡，依 (run_id, step_index) 取序。
   *
   * 一個 session 可能跑多趟 loop，故排序必須帶上 run_id，否則不同趟的步驟會
   * 交錯（兩趟都有 step_index 0）。分組交給 agentTrajectory.ts 處理。
   *
   * flag 關閉時此表為空，回空陣列是正常狀態而非異常。
   */
  async findAgentSteps(sessionId: string): Promise<Tables<"agent_steps">[]> {
    const { data, error } = await this.client
      .from("agent_steps")
      .select("*")
      .eq("session_id", sessionId)
      .order("run_id", { ascending: true })
      .order("step_index", { ascending: true });
    if (error) {
      throw new RepositoryError("agent_steps", "findAgentSteps", error.message);
    }
    return data ?? [];
  }

  /** 客戶的原始描述——全部列出（非只有最新一筆），後台需看到說過的每一句。 */
  async findRawInputs(sessionId: string): Promise<Tables<"raw_inputs">[]> {
    const { data, error } = await this.client
      .from("raw_inputs")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) {
      throw new RepositoryError("raw_inputs", "findRawInputs", error.message);
    }
    return data ?? [];
  }
}

export const quoteReviewRepository = new QuoteReviewRepository();
