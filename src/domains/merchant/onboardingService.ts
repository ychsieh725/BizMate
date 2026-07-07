import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { RepositoryError } from "@/lib/supabase/repository.ts";

/**
 * 把全域範本價目表複製到指定商家名下（onboarding 的核心步驟）。
 * 空價目表會讓計價直接 out_of_scope，範本讓「註冊完即可發連結」成立。
 *
 * 冪等：商家已有任何 rate_card_base 列即整個跳過（不覆蓋商家自己的編輯）。
 * 回傳實際複製的筆數（跳過時為 0/0）。
 */
export async function copyTemplateRateCard(
  merchantId: string,
): Promise<{ baseCount: number; modifierCount: number }> {
  const client = getSupabaseClient();

  const { count, error: countError } = await client
    .from("rate_card_base")
    .select("*", { count: "exact", head: true })
    .eq("merchant_id", merchantId);
  if (countError) {
    throw new RepositoryError("rate_card_base", "countByMerchant", countError.message);
  }
  if ((count ?? 0) > 0) {
    return { baseCount: 0, modifierCount: 0 };
  }

  const { data: templateBase, error: baseError } = await client
    .from("rate_card_template_base")
    .select("*");
  if (baseError) {
    throw new RepositoryError("rate_card_template_base", "findAll", baseError.message);
  }

  const { data: templateModifiers, error: modifierError } = await client
    .from("rate_card_template_modifiers")
    .select("*");
  if (modifierError) {
    throw new RepositoryError(
      "rate_card_template_modifiers",
      "findAll",
      modifierError.message,
    );
  }

  const baseRows = (templateBase ?? []).map((row) => ({
    merchant_id: merchantId,
    category: row.category,
    subtype: row.subtype,
    unit: row.unit,
    base_price: row.base_price,
    includes: row.includes,
  }));
  const modifierRows = (templateModifiers ?? []).map((row) => ({
    merchant_id: merchantId,
    category: row.category,
    modifier_name: row.modifier_name,
    trigger_condition: row.trigger_condition,
    range_min: row.range_min,
    range_max: row.range_max,
  }));

  if (baseRows.length > 0) {
    const { error } = await client.from("rate_card_base").insert(baseRows);
    if (error) {
      throw new RepositoryError("rate_card_base", "insertFromTemplate", error.message);
    }
  }
  if (modifierRows.length > 0) {
    const { error } = await client.from("rate_card_modifiers").insert(modifierRows);
    if (error) {
      throw new RepositoryError(
        "rate_card_modifiers",
        "insertFromTemplate",
        error.message,
      );
    }
  }

  return { baseCount: baseRows.length, modifierCount: modifierRows.length };
}
