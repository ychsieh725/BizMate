import type { CaseCategory } from "@/shared/types/domain.types";

/** 案件類型的中文顯示標籤（PRD 附錄 A） */
export const CASE_CATEGORY_LABELS: Record<CaseCategory, string> = {
  graphic_design: "平面設計",
  illustration: "插畫",
  web_design: "網頁設計",
};

/** 供 Wizard Step 1 依序渲染的案件類型清單 */
export const CASE_CATEGORIES: readonly CaseCategory[] = [
  "graphic_design",
  "illustration",
  "web_design",
] as const;
