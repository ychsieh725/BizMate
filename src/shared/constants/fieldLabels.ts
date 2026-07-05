/**
 * 抽取欄位的中文顯示標籤（PRD 附錄 A）。
 * 單一事實來源：Wizard 缺欄位提示與（未來）LINE 反問共用，避免各處硬編碼。
 * 與 parserFields.ts 的欄位名一一對應。
 */
export const FIELD_LABELS: Record<string, string> = {
  // 共用
  license_scope: "授權範圍",
  deadline_days: "交期天數",
  revision_count: "修改次數",
  // 平面設計 / 插畫 / 網頁設計 共用
  subtype: "子類型",
  quantity: "數量",
  // 平面設計
  includes_pitch_rounds: "提案輪數",
  // 插畫
  coloring_complexity: "上色複雜度",
  resolution_requirement: "解析度需求",
  // 網頁設計
  page_count: "頁數",
  feature_modules: "功能模組",
  includes_rwd: "響應式設計（RWD）",
  includes_cms: "內容管理（CMS）",
};

/** 取欄位中文標籤；未知欄位回傳原名（不讓 UI 空白）。 */
export function fieldLabel(fieldName: string): string {
  return FIELD_LABELS[fieldName] ?? fieldName;
}
