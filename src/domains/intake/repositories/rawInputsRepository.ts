import { BaseRepository } from "@/lib/supabase/repository.ts";

/**
 * raw_inputs 表 repository。每次客戶送出描述都新增一列（保留完整歷程，
 * SDS §12：不做去重，供之後分析）。標準 CRUD 即足夠。
 */
export class RawInputsRepository extends BaseRepository<"raw_inputs"> {
  constructor() {
    super("raw_inputs");
  }
}

export const rawInputsRepository = new RawInputsRepository();
