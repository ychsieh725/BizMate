import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * clarification_turns 表 repository。
 * 支援批次反問迴圈：一輪建立多題（每缺漏欄位一筆、共用同一 round）、
 * 找出本輪待回答的所有 turn、取已回答問答對重組上下文。
 * 輪數計算改由呼叫端從已回答 turn 的相異 round 數推得（不再逐 turn 計數）。
 */
export class ClarificationTurnsRepository extends BaseRepository<"clarification_turns"> {
  constructor() {
    super("clarification_turns");
  }

  /**
   * 取該 session 所有尚未回答（answer is null）的 turn。批次模式下這些同屬
   * 當前待答的那一輪（整輪一起建、一起答）。依 round 遞增穩定排序。
   */
  async findUnanswered(
    sessionId: string,
  ): Promise<Tables<"clarification_turns">[]> {
    const { data, error } = await this.client
      .from("clarification_turns")
      .select("*")
      .eq("session_id", sessionId)
      .is("answer", null)
      .order("round", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "clarification_turns",
        "findUnanswered",
        error.message,
      );
    }
    return data ?? [];
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
}

export const clarificationTurnsRepository = new ClarificationTurnsRepository();
