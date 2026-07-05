import type { CaseCategory, SessionStatus } from "@/shared/types/domain.types";

/**
 * Wizard 前端型別（僅前端使用，與後端 API 契約對齊但採 camelCase）。
 * 邊界轉換（snake_case API ↔ camelCase 前端）集中在 wizardApi.ts。
 */

/** Wizard 四步驟狀態（page 容器的單一事實來源）。 */
export type WizardStep = "category" | "describe" | "submitting" | "result";

/** POST /describe 成功後的結果（已從 snake_case 轉為 camelCase）。 */
export type DescribeOutcome = {
  status: SessionStatus;
  missingFields?: readonly string[];
  quoteCode?: string;
  outOfScope?: boolean;
};

/** 前端 API 呼叫統一結果型別——不 throw，錯誤走 ok:false 分支。 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; httpStatus: number };

/** POST /sessions 成功回傳。 */
export type CreatedSession = {
  sessionId: string;
  status: SessionStatus;
};

/** 已選定的案件類型（Step 1 → Step 2 傳遞）。 */
export type SelectedCategory = CaseCategory;
