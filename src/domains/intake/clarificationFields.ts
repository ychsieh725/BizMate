/**
 * Clarification 的 deterministic 核心：選欄優先序與輪數上限（FR-CL-1、FR-CL-2）。
 * 這兩者不交給 LLM——反問「先問哪一欄」與「還能不能問」必須可靠、可測、可預測。
 */

/**
 * 反問優先序：影響金額大的先問（FR-CL-1「優先詢問影響金額最大的欄位」）。
 * subtype 決定基礎費率查表、quantity/page_count 是數量乘數，故排在授權/交期/
 * 修改次數之前；PRD 明定的三欄序（授權 > 交期 > 修改次數）內嵌其中。
 * 未列在此的欄位優先序最低，依缺漏清單原順序穩定殿後。
 */
export const CLARIFICATION_FIELD_PRIORITY = [
  "subtype",
  "quantity",
  "page_count",
  "license_scope",
  "deadline_days",
  "revision_count",
] as const;

/** 全流程反問輪數上限（FR-CL-2，初始值；避免 agent 無限反問造成客戶疲勞）。 */
export const MAX_CLARIFICATION_ROUNDS = 3;

/**
 * 從缺漏欄位依優先序選出「下一個要問」的欄位（每次一題，FR-CL-1）。
 * 先掃優先序清單找第一個命中的；優先序未涵蓋的欄位則回傳缺漏清單第一個（依原序穩定）。
 * 缺漏清單為空回 null。
 */
export function selectNextField(missingFields: readonly string[]): string | null {
  if (missingFields.length === 0) return null;

  for (const field of CLARIFICATION_FIELD_PRIORITY) {
    if (missingFields.includes(field)) return field;
  }

  return missingFields[0];
}

/**
 * 是否還能再反問（未達輪數上限，FR-CL-2）。
 * completedRounds 為「已完成的反問輪數」；達上限後由呼叫端轉保守估價（FR-CL-3、4.2）。
 */
export function canAskMoreClarifications(completedRounds: number): boolean {
  return completedRounds < MAX_CLARIFICATION_ROUNDS;
}
