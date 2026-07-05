import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * clarification_turns 表 repository。
 * 支援反問迴圈：建立新一輪問題、找出待回答的 turn、計算已回答輪數（判斷是否達上限）。
 */
export class ClarificationTurnsRepository extends BaseRepository<"clarification_turns"> {
  constructor() {
    super("clarification_turns");
  }

  /** 找出該 session 尚未回答（answer is null）的最新一輪；無則回 null。 */
  async findUnansweredLatest(
    sessionId: string,
  ): Promise<Tables<"clarification_turns"> | null> {
    const { data, error } = await this.client
      .from("clarification_turns")
      .select("*")
      .eq("session_id", sessionId)
      .is("answer", null)
      .order("round", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(
        "clarification_turns",
        "findUnansweredLatest",
        error.message,
      );
    }
    return data ?? null;
  }

  /** 取該 session 已回答的問答對，依 round 遞增——供反問重新解析時組合上下文。 */
  async findAnsweredOrdered(
    sessionId: string,
  ): Promise<Tables<"clarification_turns">[]> {
    const { data, error } = await this.client
      .from("clarification_turns")
      .select("*")
      .eq("session_id", sessionId)
      .not("answer", "is", null)
      .order("round", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "clarification_turns",
        "findAnsweredOrdered",
        error.message,
      );
    }
    return data ?? [];
  }

  /** 計算該 session 已回答（answer 非 null）的輪數——用於輪數上限判斷。 */
  async countAnswered(sessionId: string): Promise<number> {
    const { count, error } = await this.client
      .from("clarification_turns")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .not("answer", "is", null);
    if (error) {
      throw new RepositoryError(
        "clarification_turns",
        "countAnswered",
        error.message,
      );
    }
    return count ?? 0;
  }
}

export const clarificationTurnsRepository = new ClarificationTurnsRepository();
