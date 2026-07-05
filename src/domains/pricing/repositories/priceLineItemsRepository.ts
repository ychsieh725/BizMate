import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { TablesInsert } from "@/lib/supabase/database.types.ts";

/**
 * price_line_items 表 repository。一張報價的多個項目一次批次寫入。
 */
export class PriceLineItemsRepository extends BaseRepository<"price_line_items"> {
  constructor() {
    super("price_line_items");
  }

  /** 批次新增報價項目；空陣列直接略過。 */
  async createMany(
    rows: TablesInsert<"price_line_items">[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client.from("price_line_items").insert(rows);
    if (error) {
      throw new RepositoryError(
        "price_line_items",
        "createMany",
        error.message,
      );
    }
  }
}

export const priceLineItemsRepository = new PriceLineItemsRepository();
