import {
  BaseRepository,
  RepositoryError,
} from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * cost_logs 表的 repository（append-only 觀測域）。
 * 繼承標準 CRUD，額外提供依 session 查詢——dashboard 要看單張報價的累積成本。
 */
export class CostLogsRepository extends BaseRepository<"cost_logs"> {
  constructor() {
    super("cost_logs");
  }

  /** 查某 session 的所有成本紀錄（FR-LN-6：單張報價累積成本） */
  async findBySession(sessionId: string): Promise<Tables<"cost_logs">[]> {
    const { data, error } = await this.client
      .from("cost_logs")
      .select("*")
      .eq("session_id", sessionId);
    if (error) {
      throw new RepositoryError("cost_logs", "findBySession", error.message);
    }
    return data ?? [];
  }
}

export const costLogsRepository = new CostLogsRepository();
