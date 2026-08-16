import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables, TablesInsert } from "@/lib/supabase/database.types.ts";

/**
 * extracted_fields 表 repository。
 * 以 (session_id, field_name) upsert——重新抽取（clarification 迴圈）時更新既有列，
 * 而非累積重複列（對應 schema 的 UNIQUE(session_id, field_name)）。
 */
export class ExtractedFieldsRepository extends BaseRepository<"extracted_fields"> {
  constructor() {
    super("extracted_fields");
  }

  /** 批次 upsert 抽取欄位；空陣列直接略過。 */
  async upsertMany(
    rows: TablesInsert<"extracted_fields">[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client
      .from("extracted_fields")
      .upsert(rows, { onConflict: "session_id,field_name" });
    if (error) {
      throw new RepositoryError(
        "extracted_fields",
        "upsertMany",
        error.message,
      );
    }
  }

  /**
   * 取某 session 目前已記錄的所有欄位（A4）。
   *
   * agent-service 會在 loop 期間即時寫入這張表，故 fallback 時要能讀回來——
   * agent 走了幾步的成果必須能被繼承，否則交棒就等於從頭來過。
   */
  async findBySession(
    sessionId: string,
  ): Promise<Tables<"extracted_fields">[]> {
    const { data, error } = await this.client
      .from("extracted_fields")
      .select("*")
      .eq("session_id", sessionId);
    if (error) {
      throw new RepositoryError(
        "extracted_fields",
        "findBySession",
        error.message,
      );
    }
    return data ?? [];
  }
}

export const extractedFieldsRepository = new ExtractedFieldsRepository();
