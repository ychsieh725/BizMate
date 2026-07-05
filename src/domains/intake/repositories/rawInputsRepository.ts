import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * raw_inputs 表 repository。每次客戶送出描述都新增一列（保留完整歷程，
 * SDS §12：不做去重，供之後分析）。
 */
export class RawInputsRepository extends BaseRepository<"raw_inputs"> {
  constructor() {
    super("raw_inputs");
  }

  /** 取該 session 最新一筆原始描述（反問重新解析時作為基底文字）；無則回 null。 */
  async findLatestBySession(
    sessionId: string,
  ): Promise<Tables<"raw_inputs"> | null> {
    const { data, error } = await this.client
      .from("raw_inputs")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new RepositoryError("raw_inputs", "findLatestBySession", error.message);
    }
    return data ?? null;
  }
}

export const rawInputsRepository = new RawInputsRepository();
