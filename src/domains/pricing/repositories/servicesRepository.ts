import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * rate_card_base 的 dashboard CRUD repository（5.5）。
 * 與既有唯讀 rateCardRepository（pricing 查表用）分開——「計價查詢」
 * 與「後台管理」是不同關注點，各自單一職責。
 * create/update/findById 繼承 BaseRepository 標準 CRUD。
 */
export class ServicesRepository extends BaseRepository<"rate_card_base"> {
  constructor() {
    super("rate_card_base");
  }

  /** 該商家所有服務項目，含已停售（is_active=false）——後台列表要能檢視。 */
  async findAllByMerchant(
    merchantId: string,
  ): Promise<Tables<"rate_card_base">[]> {
    const { data, error } = await this.client
      .from("rate_card_base")
      .select("*")
      .eq("merchant_id", merchantId)
      .order("category", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "rate_card_base",
        "findAllByMerchant",
        error.message,
      );
    }
    return data ?? [];
  }

  /** 該商家所有加成規則（唯讀顯示用，不分 category）。 */
  async findModifiersByMerchant(
    merchantId: string,
  ): Promise<Tables<"rate_card_modifiers">[]> {
    const { data, error } = await this.client
      .from("rate_card_modifiers")
      .select("*")
      .eq("merchant_id", merchantId);
    if (error) {
      throw new RepositoryError(
        "rate_card_modifiers",
        "findModifiersByMerchant",
        error.message,
      );
    }
    return data ?? [];
  }
}

export const servicesRepository = new ServicesRepository();
