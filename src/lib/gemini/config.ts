/**
 * Gemini 模型分層設定（ADR-4：Flash-Lite 輕量任務 / Flash 旗艦款推理，全程不用 Pro）。
 *
 * 選用 2.5 系列：文件確認具免費層額度 + rate limit，符合 SRS C-2「免費層優先」。
 * 模型代號 config 化（非寫死在呼叫邏輯），Google 版本更迭時只改這裡（PRD §10）。
 */
export type ModelTier = "light" | "reasoning";

export const MODEL_TIERS: Record<ModelTier, string> = {
  // 抽取 / 反問 / 修改解析（Intake、Clarification、LINE Revision）
  // 選 3.1 Flash-Lite：免費層 RPD 500（2.5 僅 20），對 eval 批次至關重要
  light: "gemini-3.1-flash-lite",
  // 報價推理（Pricing Reasoning Agent）
  reasoning: "gemini-2.5-flash",
};
