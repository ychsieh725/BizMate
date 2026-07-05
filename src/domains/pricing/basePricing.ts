import type { CaseCategory } from "@/shared/types/domain.types";
import type { Tables } from "@/lib/supabase/database.types.ts";
import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import type {
  ExtractedValues,
  LineItem,
  PricingResult,
} from "@/domains/pricing/pricingTypes.ts";

/** 各 category 用來乘基礎單價的「數量」欄位名。 */
const QUANTITY_FIELD: Record<CaseCategory, string> = {
  graphic_design: "quantity",
  illustration: "quantity",
  web_design: "page_count",
};

/** 從抽取值解析數量；缺漏或非正整數一律回 1（保守，不放大金額）。 */
function parseQuantity(category: CaseCategory, fields: ExtractedValues): number {
  const raw = fields[QUANTITY_FIELD[category]]?.value;
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * 將授權範圍抽取值正規化到 rate card 的授權維度值域。
 * P0 用關鍵字比對（deterministic、可測）；抽取值多變（「商用」「商業用途」），
 * 故以包含關係判斷，而非精確相等。判斷不出回 null。
 */
export function normalizeLicenseScope(value: string | null): string | null {
  if (value == null) return null;
  if (value.includes("獨家") || value.includes("買斷")) return "獨家買斷";
  if (value.includes("商業") || value.includes("商用")) return "商業使用";
  if (value.includes("個人")) return "個人使用";
  return null;
}

/**
 * 判斷固定倍率 modifier 是否觸發。
 * P0 只處理「授權範圍=X」型觸發條件（seed 的固定 modifier 皆屬此類）；
 * 其他型別的觸發條件無法 deterministic 判斷，保守跳過，留給 4.3 Pricing Agent。
 */
function isModifierTriggered(
  modifier: Tables<"rate_card_modifiers">,
  fields: ExtractedValues,
): boolean {
  const match = modifier.trigger_condition.match(/^授權範圍=(.+)$/);
  if (!match) return false;
  const required = match[1].trim();
  return normalizeLicenseScope(fields.license_scope?.value ?? null) === required;
}

/**
 * deterministic 基礎計價（3.5，FR-PR-1、FR-PR-4）。
 *
 * = 基礎費（base_price × 數量）+ 固定倍率加成（modifier min==max 且觸發）。
 * 區間 modifier（min≠max）不在此判斷，留給 4.3 Pricing Reasoning Agent。
 * 查無子類型 → outOfScope（FR-PR-3）。每個項目帶 ruleId/modifierId 可回溯。
 */
export async function computeBasePricing(
  category: CaseCategory,
  fields: ExtractedValues,
): Promise<PricingResult> {
  const subtype = fields.subtype?.value ?? null;
  const base = subtype
    ? await rateCardRepository.findBase(category, subtype)
    : null;

  if (base == null || base.base_price == null) {
    return { lineItems: [], total: 0, outOfScope: true };
  }

  const quantity = parseQuantity(category, fields);
  const baseAmount = Math.round(base.base_price * quantity);
  const lineItems: LineItem[] = [
    {
      itemName: `${base.subtype}基本費`,
      amount: baseAmount,
      ruleId: base.id,
      modifierId: null,
      agentReasoning: null,
    },
  ];

  const modifiers = await rateCardRepository.findModifiers(category);
  for (const modifier of modifiers) {
    const { range_min, range_max } = modifier;
    if (range_min == null || range_max == null) continue;
    if (range_min !== range_max) continue; // 區間交給 4.3
    if (!isModifierTriggered(modifier, fields)) continue;

    lineItems.push({
      itemName: modifier.modifier_name,
      amount: Math.round(baseAmount * range_min),
      ruleId: null,
      modifierId: modifier.id,
      agentReasoning: null,
    });
  }

  const total = lineItems.reduce((sum, item) => sum + item.amount, 0);
  return { lineItems, total, outOfScope: false };
}
