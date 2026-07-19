import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables, TablesInsert } from "@/lib/supabase/database.types.ts";

/**
 * eval_runs 表 repository（append-only 觀測域，WBS 7.2）。
 *
 * 一次評估寫入多列——每個指標一列（metric_name + value），而非一列塞進所有
 * 指標。這是 schema 既有的設計，好處是新增指標不必改 schema，代價是查詢要
 * 自己 pivot（可接受：結果以 SQL 直查，不做 dashboard）。
 */
export class EvalRunsRepository extends BaseRepository<"eval_runs"> {
  constructor() {
    super("eval_runs");
  }

  /** 批次寫入一次評估的全部指標；空陣列直接略過。 */
  async createMany(rows: TablesInsert<"eval_runs">[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client.from("eval_runs").insert(rows);
    if (error) {
      throw new RepositoryError("eval_runs", "createMany", error.message);
    }
  }

  /** 取某次執行的全部指標（供驗證寫入結果與跨次比較）。 */
  async findByRunId(runId: string): Promise<Tables<"eval_runs">[]> {
    const { data, error } = await this.client
      .from("eval_runs")
      .select("*")
      .eq("run_id", runId);
    if (error) {
      throw new RepositoryError("eval_runs", "findByRunId", error.message);
    }
    return data ?? [];
  }
}

export const evalRunsRepository = new EvalRunsRepository();
