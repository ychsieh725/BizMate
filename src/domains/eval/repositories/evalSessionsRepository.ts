import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { RepositoryError } from "@/lib/supabase/repository.ts";
import { EVAL_CONTACT_EMAIL } from "@/domains/eval/evalConstants.ts";

/**
 * Eval 測試 session 的清查與清理（WBS 7.2 附帶治理）。
 *
 * ── 為何刪除前必須先數 quotes ──
 * sessions 的子表全是 ON DELETE CASCADE，其中包含 quotes——誤刪一筆有報價的
 * session，報價單會一起消失且無法復原。故本 repository 一律先回報「會連帶
 * 刪掉幾筆報價」，由呼叫端決定是否繼續，而非直接執行刪除。
 *
 * cost_logs 是 ON DELETE SET NULL，成本紀錄會保留（成本確實發生過，FinOps
 * 的用量統計不該因清理測試資料而失真）。
 */

export interface CleanupTarget {
  readonly sessionIds: string[];
  /** 這些 session 連帶會被 CASCADE 刪除的報價數——大於 0 代表清理條件有問題。 */
  readonly attachedQuotes: number;
}

function client() {
  return getSupabaseClient();
}

/** 數這批 session 底下有多少報價（CASCADE 會一併刪除）。 */
async function countAttachedQuotes(sessionIds: string[]): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const { count, error } = await client()
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .in("session_id", sessionIds);
  if (error) {
    throw new RepositoryError("quotes", "countAttachedQuotes", error.message);
  }
  return count ?? 0;
}

export class EvalSessionsRepository {
  /** 找出由 Eval Runner 標記的測試 session。 */
  async findMarked(): Promise<CleanupTarget> {
    const { data, error } = await client()
      .from("sessions")
      .select("id")
      .eq("contact_email", EVAL_CONTACT_EMAIL);
    if (error) {
      throw new RepositoryError("sessions", "findMarked", error.message);
    }
    const sessionIds = (data ?? []).map((row) => row.id);
    return { sessionIds, attachedQuotes: await countAttachedQuotes(sessionIds) };
  }

  /**
   * 找出標記機制上線前留下的測試 session：無聯絡信箱、且沒有產出報價。
   *
   * 判斷條件是啟發式的——真實客戶中途放棄的 session 也符合，故呼叫端必須先
   * 以 dry-run 檢視數量再決定。標記機制上線後，新資料一律走 findMarked。
   */
  async findLegacyOrphans(): Promise<CleanupTarget> {
    const { data: sessions, error: sessionsError } = await client()
      .from("sessions")
      .select("id")
      .is("contact_email", null);
    if (sessionsError) {
      throw new RepositoryError(
        "sessions",
        "findLegacyOrphans",
        sessionsError.message,
      );
    }

    const candidateIds = (sessions ?? []).map((row) => row.id);
    if (candidateIds.length === 0) {
      return { sessionIds: [], attachedQuotes: 0 };
    }

    // 以兩次明確查詢取代 embed：手寫的 database.types.ts 未宣告 sessions↔quotes
    // 關聯，PostgREST 的巢狀選取無法通過型別檢查，且相減的意圖更直白。
    const { data: quotes, error: quotesError } = await client()
      .from("quotes")
      .select("session_id")
      .in("session_id", candidateIds);
    if (quotesError) {
      throw new RepositoryError(
        "quotes",
        "findLegacyOrphans",
        quotesError.message,
      );
    }

    const quotedSessionIds = new Set((quotes ?? []).map((row) => row.session_id));
    const sessionIds = candidateIds.filter((id) => !quotedSessionIds.has(id));

    return { sessionIds, attachedQuotes: await countAttachedQuotes(sessionIds) };
  }

  /**
   * 刪除指定 session（子表由 CASCADE 連帶清除，cost_logs 保留）。
   * 分批送出，避免單次 in() 條件過長被 PostgREST 拒絕。
   */
  async deleteByIds(sessionIds: readonly string[]): Promise<number> {
    const BATCH_SIZE = 100;
    let deleted = 0;

    for (let index = 0; index < sessionIds.length; index += BATCH_SIZE) {
      const batch = sessionIds.slice(index, index + BATCH_SIZE);
      const { error } = await client().from("sessions").delete().in("id", batch);
      if (error) {
        throw new RepositoryError("sessions", "deleteByIds", error.message);
      }
      deleted += batch.length;
    }

    return deleted;
  }
}

export const evalSessionsRepository = new EvalSessionsRepository();
