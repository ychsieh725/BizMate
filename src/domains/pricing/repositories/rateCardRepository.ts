import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";
import type { CaseCategory, RateCardService } from "@/shared/types/domain.types";

/**
 * Rate card 查詢（3.5 基礎費率查表，FR-PR-1）。
 * 讀取 rate_card_base 與 rate_card_modifiers，供 deterministic 計價使用。
 */
export class RateCardRepository {
  private get client() {
    return getSupabaseClient();
  }

  /** 依 (merchant, category, subtype) 查基礎費率列（UNIQUE，最多一筆）；查無回 null。 */
  async findBase(
    merchantId: string,
    category: CaseCategory,
    subtype: string,
  ): Promise<Tables<"rate_card_base"> | null> {
    const { data, error } = await this.client
      .from("rate_card_base")
      .select("*")
      .eq("merchant_id", merchantId)
      .eq("category", category)
      .eq("subtype", subtype)
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      throw new RepositoryError("rate_card_base", "findBase", error.message);
    }
    return data ?? null;
  }

  /**
   * 取該商家該 category 目前在售（is_active）的服務項目（WBS 6.8）。
   * 供 Parser 作為 subtype 的合法值域——只回在售項目，停售的服務不該被抽出來報價。
   *
   * 一併取回 unit（計價單位）：它決定「數量 1」代表什麼。原本只取 subtype，
   * 模型無從判斷「一組貼圖，八款」該填 1 還是 8，A6 實測即因此把該案例
   * 算成 8 倍價。單位隨商家而異，只能從資料帶出來，不能寫死在 prompt。
   */
  async findActiveServices(
    merchantId: string,
    category: CaseCategory,
  ): Promise<RateCardService[]> {
    const { data, error } = await this.client
      .from("rate_card_base")
      .select("subtype, unit")
      .eq("merchant_id", merchantId)
      .eq("category", category)
      .eq("is_active", true);
    if (error) {
      throw new RepositoryError(
        "rate_card_base",
        "findActiveServices",
        error.message,
      );
    }
    return (data ?? []).map((row) => ({ subtype: row.subtype, unit: row.unit }));
  }

  /** 取該商家該 category 適用的加成係數：專屬（category=給定）+ 共用（category IS NULL）。 */
  async findModifiers(
    merchantId: string,
    category: CaseCategory,
  ): Promise<Tables<"rate_card_modifiers">[]> {
    const { data, error } = await this.client
      .from("rate_card_modifiers")
      .select("*")
      .eq("merchant_id", merchantId)
      .or(`category.eq.${category},category.is.null`);
    if (error) {
      throw new RepositoryError(
        "rate_card_modifiers",
        "findModifiers",
        error.message,
      );
    }
    return data ?? [];
  }
}

export const rateCardRepository = new RateCardRepository();
