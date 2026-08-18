/**
 * agent tool 與 step 狀態的中文標籤（A7）。
 *
 * 後台是給商家看的，`lookup_rate_card` 這種名稱對他們沒有意義。但也刻意**不**
 * 把原始名稱藏起來：軌跡的用途是除錯，開發者需要能把畫面上看到的東西對回
 * 程式碼裡的 tool，所以 UI 同時顯示中文說明與原始名稱。
 *
 * ## 為什麼用查表而非 switch
 *
 * 與 `transitions.ts` 同一個理由：查無此鍵是天然的預設路徑，不需要 default
 * 分支。新增 tool 卻忘了加標籤時，畫面會退回顯示原始名稱，而不是壞掉。
 */

/** tool 名稱 → 商家看得懂的說明。未列出者由 agentToolLabel 退回原始名稱。 */
const AGENT_TOOL_LABELS: Record<string, string> = {
  lookup_rate_card: "查詢價目表",
  record_fields: "記錄需求欄位",
  ask_customer: "向客戶提問",
  compute_quote: "計算報價",
};

/**
 * 取 tool 的中文說明。未知的 tool 回傳原始名稱而非「未知」，
 * 因為在除錯情境下，原始名稱本身就是最有用的資訊。
 */
export function agentToolLabel(toolName: string): string {
  return AGENT_TOOL_LABELS[toolName] ?? toolName;
}

/** step 狀態 → 中文標籤。 */
export const AGENT_STEP_STATUS_LABELS = {
  ok: "完成",
  // 「不合規」而非「失敗」：這是護欄擋下不合規參數、agent 隨後自行修正的
  // 正常現象（A6 的 web-007 即為實例），寫成失敗會讓護欄生效看起來像故障。
  rejected: "參數不合規，已重試",
  error: "執行錯誤",
  fallback: "退回既有流程",
} as const;

/** 一趟 loop 的最終去向 → 中文標籤。 */
export const AGENT_RUN_OUTCOME_LABELS = {
  completed: "agent 完成",
  fallback: "已交棒",
  error: "執行錯誤",
} as const;
