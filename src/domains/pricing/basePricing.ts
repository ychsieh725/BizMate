import type { CaseCategory } from "@/shared/types/domain.types";

import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import { normalizeLicenseScope } from "@/domains/pricing/licenseScope.ts";
import { evaluateModifier } from "@/domains/pricing/modifierEvaluators.ts";
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
 * 授權範圍正規化已抽至 licenseScope.ts（純函式、無 IO 依賴），供 eval 的比對
 * 邏輯重用而不必拉進整條 DB 依賴鏈。此處 re-export 維持既有呼叫端不變。
 */
export { normalizeLicenseScope };

/**
 * deterministic 基礎計價（3.5，FR-PR-1、FR-PR-4）。
 *
 * = 基礎費（base_price × 數量）+ 所有觸發的加成係數。
 *
 * **WBS 6.1 階段一起，區間係數也在此判斷。** 在此之前只處理固定倍率
 * （min === max）且只認得「授權範圍=X」一種觸發條件，實際後果是「三天內急件」
 * 與「一個月交件」報價完全相同。求值規則見 modifierEvaluators.ts；能確定性
 * 判斷的一律在此算完，不交給 LLM。
 *
 * 查無子類型 → outOfScope（FR-PR-3）。每個項目帶 ruleId/modifierId 可回溯。
 */
export async function computeBasePricing(
  merchantId: string,
  category: CaseCategory,
  fields: ExtractedValues,
): Promise<PricingResult> {
  const subtype = fields.subtype?.value ?? null;
  const base = subtype
    ? await rateCardRepository.findBase(merchantId, category, subtype)
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

  const modifiers = await rateCardRepository.findModifiers(merchantId, category);
  for (const modifier of modifiers) {
    const evaluation = evaluateModifier(modifier, fields);
    if (evaluation === null) continue;

    // applications 與 ratio 分開相乘：區間驗證的對象是單次套用的倍率，
    // 「每加一個模組」套用 3 次不代表倍率越界（見 modifierEvaluators.ts）。
    const amount = Math.round(baseAmount * evaluation.ratio * evaluation.applications);
    lineItems.push({
      itemName:
        evaluation.applications > 1
          ? `${modifier.modifier_name} × ${evaluation.applications}`
          : modifier.modifier_name,
      amount,
      ruleId: null,
      modifierId: modifier.id,
      agentReasoning: null,
    });
  }

  const total = lineItems.reduce((sum, item) => sum + item.amount, 0);
  return { lineItems, total, outOfScope: false };
}
