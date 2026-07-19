import type { ExtractedValues } from "@/domains/pricing/pricingTypes.ts";
import type { FieldComparison } from "@/domains/eval/evalTypes.ts";
import { normalizeFieldValue } from "@/domains/eval/normalization.ts";

/**
 * 標註 vs 抽取的比對（WBS 7.2，純函式）。
 * 從 evalRunner 抽出，讓「比對規則」可以獨立於 Gemini 與資料庫被驗證。
 */

/** 模型抽取結果的最小形狀（只取 value，confidence 已在缺漏判定用過）。 */
type ExtractedFields = Record<string, { readonly value: string | null } | undefined>;

/**
 * 逐欄比對標註值與抽取值（兩側都先正規化，見 normalization.ts 的對齊原則）。
 * 以標註的欄位集合為準——模型多回的欄位不存在（schema 已限制形狀），
 * 少回的欄位會以 null 參與比對並被記為錯誤。
 */
export function compareFields(
  expectedFields: Readonly<Record<string, string | null>>,
  actualFields: ExtractedFields,
): FieldComparison[] {
  return Object.entries(expectedFields).map(([name, expectedRaw]) => {
    const expected = normalizeFieldValue(name, expectedRaw);
    const actual = normalizeFieldValue(name, actualFields[name]?.value ?? null);
    return { name, expected, actual, correct: expected === actual };
  });
}

/**
 * 把標註欄位轉成計價輸入，用來算「抽取完全正確時應有的報價」。
 *
 * 刻意傳入**未正規化**的標註原值：computeBasePricing 內部有自己的正規化
 * （normalizeLicenseScope、parseQuantity），此處若先正規化一次，量到的就不是
 * 計價的真實行為。
 */
export function toExtractedValues(
  expectedFields: Readonly<Record<string, string | null>>,
): ExtractedValues {
  return Object.fromEntries(
    Object.entries(expectedFields).map(([name, value]) => [name, { value }]),
  );
}
