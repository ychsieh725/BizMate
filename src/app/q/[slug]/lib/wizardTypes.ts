import type { CaseCategory, SessionStatus } from "@/shared/types/domain.types";

/**
 * Wizard 前端型別（僅前端使用，與後端 API 契約對齊但採 camelCase）。
 * 邊界轉換（snake_case API ↔ camelCase 前端）集中在 wizardApi.ts。
 */

/**
 * Wizard 畫面（page 容器的單一事實來源）。clarify=回答反問（同一 session）。
 * 「送出中」是各畫面的修飾狀態（submitting 布林），不是獨立畫面，故不列入。
 */
export type WizardStep = "category" | "describe" | "clarify" | "result";

/**
 * 解析（Parser）後的結果，describe 與 answer 兩端共用同一形狀（已從
 * snake_case 轉為 camelCase）。反問路徑帶 question/targetField，出報價路徑
 * 帶 quoteCode（conservative 表反問用盡後的保守估算）。
 */
export type DescribeOutcome = {
  status: SessionStatus;
  missingFields?: readonly string[];
  question?: string;
  targetField?: string;
  quoteCode?: string;
  outOfScope?: boolean;
  conservative?: boolean;
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
