import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { TablesInsert } from "@/lib/supabase/database.types.ts";

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
}

export const extractedFieldsRepository = new ExtractedFieldsRepository();
