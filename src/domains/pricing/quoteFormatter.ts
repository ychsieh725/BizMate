import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";
import type { PricingResult } from "@/domains/pricing/pricingTypes.ts";

/** quote_code 的類型首字（SDS §6.4：{類型首字}-{年月}{三位流水號}）。 */
const CATEGORY_CODE: Record<CaseCategory, string> = {
  graphic_design: "G",
  illustration: "I",
  web_design: "W",
};

function twoDigit(n: number): string {
  return String(n).padStart(2, "0");
}

/** 產生 quote_code 的年月+類型前綴，如 "G-2607"。 */
export function quoteCodePrefix(category: CaseCategory, now: Date): string {
  const yy = twoDigit(now.getFullYear() % 100);
  const mm = twoDigit(now.getMonth() + 1);
  return `${CATEGORY_CODE[category]}-${yy}${mm}`;
}

/**
 * 配發商家內唯一的 quote_code（3.4、FR-LN-2）。
 * 流水號 = 該商家當月當類型既有筆數 + 1；
 * 最終唯一性由 DB 的 UNIQUE (merchant_id, quote_code) 兜底。
 * now 可注入以利測試。
 */
export async function generateQuoteCode(
  merchantId: string,
  category: CaseCategory,
  now: Date = new Date(),
): Promise<string> {
  const prefix = quoteCodePrefix(category, now);
  const count = await quotesRepository.countByCodePrefix(merchantId, prefix);
  const serial = String(count + 1).padStart(3, "0");
  return `${prefix}${serial}`;
}

function formatTwd(amount: number): string {
  return `NT$ ${amount.toLocaleString("en-US")}`;
}

/**
 * 將計價結果渲染成給接案者看的文字報價預覽（3.4，deterministic 純函式）。
 * outOfScope 案件不虛構金額，明確標示需人工評估（FR-PR-3）。
 */
export function formatQuotePreview(
  category: CaseCategory,
  result: PricingResult,
  quoteCode: string,
): string {
  const header = `報價單 ${quoteCode}（${CASE_CATEGORY_LABELS[category]}）`;
  const divider = "──────────────";

  if (result.outOfScope) {
    return [
      header,
      divider,
      "此案件超出現有報價規則，請人工評估。",
    ].join("\n");
  }

  const lines = result.lineItems.map(
    (item) => `${item.itemName}　${formatTwd(item.amount)}`,
  );

  return [
    header,
    divider,
    ...lines,
    divider,
    `總計　${formatTwd(result.total)}`,
  ].join("\n");
}
