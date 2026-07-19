import type { CaseCategory } from "@/shared/types/domain.types";
import type { GoldenCase } from "@/domains/eval/goldenSet.types.ts";
import { GRAPHIC_CASES } from "@/domains/eval/goldenCases.graphic.ts";
import { ILLUSTRATION_CASES } from "@/domains/eval/goldenCases.illustration.ts";
import { WEB_CASES } from "@/domains/eval/goldenCases.web.ts";

/**
 * Golden Set 匯總入口（WBS 7.1）。
 *
 * 案例依 category 分檔維護（避免單檔過長），此處組合為單一清單供
 * Eval Runner（7.2）與資料完整性測試消費。
 */
export const GOLDEN_CASES: readonly GoldenCase[] = [
  ...GRAPHIC_CASES,
  ...ILLUSTRATION_CASES,
  ...WEB_CASES,
];

/** 取某案件類型的全部案例。 */
export function casesByCategory(category: CaseCategory): GoldenCase[] {
  return GOLDEN_CASES.filter((goldenCase) => goldenCase.category === category);
}

/** 依 id 取單則案例；找不到回 undefined（供指標報告按 id 追蹤個案）。 */
export function caseById(id: string): GoldenCase | undefined {
  return GOLDEN_CASES.find((goldenCase) => goldenCase.id === id);
}
