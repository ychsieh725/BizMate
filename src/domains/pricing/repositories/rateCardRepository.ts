import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";
import type { CaseCategory } from "@/shared/types/domain.types";

/**
 * Rate card 查詢（3.5 基礎費率查表，FR-PR-1）。
 * 讀取 rate_card_base 與 rate_card_modifiers，供 deterministic 計價使用。
 */
export class RateCardRepository {
  private get client() {
    return getSupabaseClient();
  }

  /** 依 (category, subtype) 查基礎費率列（UNIQUE，最多一筆）；查無回 null。 */
  async findBase(
    category: CaseCategory,
    subtype: string,
  ): Promise<Tables<"rate_card_base"> | null> {
    const { data, error } = await this.client
      .from("rate_card_base")
      .select("*")
      .eq("category", category)
      .eq("subtype", subtype)
      .maybeSingle();
    if (error) {
      throw new RepositoryError("rate_card_base", "findBase", error.message);
    }
    return data ?? null;
  }

  /** 取該 category 適用的加成係數：專屬（category=給定）+ 共用（category IS NULL）。 */
  async findModifiers(
    category: CaseCategory,
  ): Promise<Tables<"rate_card_modifiers">[]> {
    const { data, error } = await this.client
      .from("rate_card_modifiers")
      .select("*")
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
