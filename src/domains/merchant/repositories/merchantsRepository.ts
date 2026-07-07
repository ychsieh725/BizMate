import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * merchants 表 repository（tenant 根）。
 * findBySlug 是公開報價入口 /q/{slug} 解析 tenant context 的唯一途徑。
 */
export class MerchantsRepository extends BaseRepository<"merchants"> {
  constructor() {
    super("merchants");
  }

  /** 依公開 slug 查商家；查無回 null（route 端回 404）。 */
  async findBySlug(slug: string): Promise<Tables<"merchants"> | null> {
    const { data, error } = await this.client
      .from("merchants")
      .select("*")
      .eq("public_slug", slug)
      .maybeSingle();
    if (error) {
      throw new RepositoryError("merchants", "findBySlug", error.message);
    }
    return data ?? null;
  }
}

/** 單例，供領域邏輯直接引用 */
export const merchantsRepository = new MerchantsRepository();
