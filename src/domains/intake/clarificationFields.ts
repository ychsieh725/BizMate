/**
 * Clarification 的 deterministic 核心：選欄優先序與輪數上限（FR-CL-1、FR-CL-2）。
 * 這兩者不交給 LLM——反問「先問哪一欄」與「還能不能問」必須可靠、可測、可預測。
 */

/**
 * 反問排序：影響金額大的排前面（FR-CL-1「優先詢問影響金額最大的欄位」）。
 * subtype 決定基礎費率查表、quantity/page_count 是數量乘數，故排在授權/交期
 * 之前；PRD 明定的欄序（授權 > 交期）內嵌其中。
 * 未列在此的欄位優先序最低，依缺漏清單原順序穩定殿後。
 */
export const CLARIFICATION_FIELD_PRIORITY = [
  "subtype",
  "quantity",
  "page_count",
  "license_scope",
  "deadline_days",
] as const;

/** 全流程反問輪數上限（FR-CL-2，初始值；避免 agent 無限反問造成客戶疲勞）。 */
export const MAX_CLARIFICATION_ROUNDS = 3;

/**
 * 將全部缺漏欄位依優先序排出「一輪要一次問完」的順序（批次反問）。
 * 先放優先序清單命中的（依清單序），再放未涵蓋的欄位（依缺漏清單原序穩定殿後）。
 * 缺漏清單為空回空陣列。取代舊的「每次選一題」selectNextField。
 */
export function orderMissingFields(
  missingFields: readonly string[],
): string[] {
  const prioritized = CLARIFICATION_FIELD_PRIORITY.filter((field) =>
    missingFields.includes(field),
  );
  const rest = missingFields.filter(
    (field) => !CLARIFICATION_FIELD_PRIORITY.includes(field as never),
  );
  return [...prioritized, ...rest];
}

/**
 * 是否還能再反問（未達輪數上限，FR-CL-2）。
 * completedRounds 為「已完成的反問輪數」；達上限後由呼叫端轉保守估價（FR-CL-3、4.2）。
 */
export function canAskMoreClarifications(completedRounds: number): boolean {
  return completedRounds < MAX_CLARIFICATION_ROUNDS;
}
