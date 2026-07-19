import { normalizeLicenseScope } from "@/domains/pricing/licenseScope.ts";

/**
 * 抽取值的比對正規化（WBS 7.2）。
 *
 * ── 為何要對齊下游邏輯而非字面比對 ──
 * 衡量的對象是「抽取結果餵給 pricing 後會不會算錯」，不是「字串長得像不像」。
 * basePricing 已對 license_scope 做包含式正規化、對數量做 parseInt + 回退 1，
 * 此處沿用同一套邏輯——否則「商業用途」vs「商業使用」會被記為錯誤，但下游
 * 其實算得完全正確，指標就成了假警報。假警報比沒有指標更糟：它會誤導修復
 * 方向，並讓 CI 閘門建立在錯誤的基準上。
 *
 * 刻意「不」正規化的兩個欄位，因為下游真的會出錯，必須讓它現形：
 *   - subtype：findBase 用精確相等查表，抽到「LOGO」而非「LOGO設計」就查無
 *     資料 → outOfScope，報價直接失敗。
 *   - feature_modules：「明說不需要（無）」與「完全沒提（null）」對反問行為的
 *     期待相反，混為一談會讓客戶被問已回答過的問題。
 */

/** 布林欄位的肯定／否定同義詞。 */
const AFFIRMATIVE = ["是", "true", "有", "要", "需要", "yes", "y", "1"];
const NEGATIVE = ["否", "false", "沒有", "不要", "不需要", "no", "n", "none", "0"];

/** 走 basePricing.parseQuantity 同一套回退邏輯的數量欄位。 */
const QUANTITY_FIELDS = new Set(["quantity", "page_count"]);

/** 布林欄位的前綴，與 parserFields 的值域規則一致。 */
const BOOLEAN_FIELD_PREFIX = "includes_";

/**
 * 將單一欄位值壓到可比對的正規形式。標註值與模型輸出都經過此函式後才比較。
 * 回傳 null 代表「未抽到值」。
 */
export function normalizeFieldValue(
  fieldName: string,
  raw: string | null,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (fieldName === "license_scope") return normalizeLicenseScope(trimmed);

  // 布林正規化只套用在 includes_* 欄位——若對全欄位套用，quantity 的 "1"
  // 會被當成肯定詞轉為「是」，把正確抽取記成錯誤。
  if (fieldName.startsWith(BOOLEAN_FIELD_PREFIX)) {
    const lowered = trimmed.toLowerCase();
    if (AFFIRMATIVE.includes(lowered)) return "是";
    if (NEGATIVE.includes(lowered)) return "否";
    return trimmed;
  }

  if (QUANTITY_FIELDS.has(fieldName)) {
    const parsed = Number.parseInt(trimmed, 10);
    // 對齊 parseQuantity：非正整數一律回退 1（保守，不放大金額）
    return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "1";
  }

  if (fieldName === "deadline_days") {
    const digits = trimmed.match(/\d+/);
    return digits ? digits[0] : trimmed;
  }

  return trimmed;
}
