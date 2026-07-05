import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";

/**
 * quotes 表 repository。繼承標準 CRUD（create 用於報價寫入），
 * 額外提供 quote_code 流水號所需的前綴計數。
 */
export class QuotesRepository extends BaseRepository<"quotes"> {
  constructor() {
    super("quotes");
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
