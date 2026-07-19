/**
 * 抽取欄位的合法值域（WBS 6.8）。
 *
 * ── 為何需要值域 ──
 * Parser 原本只被要求「抽出這些欄位」，未約束值域，LLM 自然回原文詞：
 * 「LOGO」而非「LOGO設計」、「精緻」而非「精緻上色」。下游 rate card 用精確
 * 相等查表，抽到原文詞就查無 → outOfScope → 報價金額為 null（7.1 golden set
 * 實測：欄位抽取準確率僅 81.4%，subtype 幾乎全數不匹配）。
 *
 * 值域在此收斂為單一事實來源，餵給 Gemini structured output 的 enum 約束，
 * 讓模型在「生成時」就受限，而非事後用模糊比對猜測。
 *
 * 註：subtype 的值域是 per-merchant 動態的（來自各商家的 rate_card_base），
 * 不在此檔——由 orchestrator 查 rate card 後傳入 Parser。
 */

/** 授權範圍（對應 rate card modifier 的「授權範圍=X」觸發條件）。 */
export const LICENSE_SCOPE_DOMAIN = [
  "個人使用",
  "商業使用",
  "獨家買斷",
] as const;

/** 上色複雜度（插畫專屬，對應「上色複雜度加成」modifier）。 */
export const COLORING_COMPLEXITY_DOMAIN = [
  "精緻上色",
  "簡易上色",
  "線稿",
] as const;

/**
 * 布林欄位（includes_*）的正規形式。
 * 用「是/否」而非 true/false——欄位值統一以字串承載（見 parserFields），
 * 且中文 prompt 下模型回中文的一致性較高。
 */
export const BOOLEAN_DOMAIN = ["是", "否"] as const;

/**
 * 明確表示「不需要 / 沒有」的正規值，用於 feature_modules 這類無固定值域的欄位。
 * 關鍵區別：「無」是客戶明說不需要（已抽到值），null 是原文完全沒提（應反問）。
 * 兩者對反問行為的期待相反，混用會讓客戶被問已回答過的問題。
 */
export const NONE_VALUE = "無";
