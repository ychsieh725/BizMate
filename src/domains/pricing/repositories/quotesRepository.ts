import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { RepositoryError } from "@/lib/supabase/repository.ts";

/**
 * quotes 表查詢（供 quote_code 流水號產生，3.4）。
 */
export class QuotesRepository {
  private get client() {
    return getSupabaseClient();
  }

  /**
   * 計算 quote_code 以指定前綴（如 "G-2607"）開頭的既有筆數，
   * 作為當月當類型的流水號基數。唯一性最終由 DB 的 quote_code UNIQUE 兜底。
   */
  async countByCodePrefix(prefix: string): Promise<number> {
    const { count, error } = await this.client
      .from("quotes")
      .select("*", { count: "exact", head: true })
      .like("quote_code", `${prefix}%`);
    if (error) {
      throw new RepositoryError("quotes", "countByCodePrefix", error.message);
    }
    return count ?? 0;
  }
}

export const quotesRepository = new QuotesRepository();
