/**
 * 授權範圍的正規化（純函式，無 IO 依賴）。
 *
 * 獨立成檔而非留在 basePricing.ts：basePricing 依賴 rateCardRepository（進而
 * 依賴 Supabase client 與環境變數），任何想重用這段純邏輯的模組都會被迫拉進
 * 整條 DB 依賴鏈。Eval 的比對正規化需要與計價完全一致的行為，故抽出共用。
 */

/**
 * 將授權範圍抽取值正規化到 rate card 的授權維度值域。
 * 以包含關係判斷而非精確相等——抽取值多變（「商用」「商業用途」「個人自用」）。
 * 判斷不出回 null。
 */
export function normalizeLicenseScope(value: string | null): string | null {
  if (value == null) return null;
  if (value.includes("獨家") || value.includes("買斷")) return "獨家買斷";
  if (value.includes("商業") || value.includes("商用")) return "商業使用";
  if (value.includes("個人")) return "個人使用";
  return null;
}
