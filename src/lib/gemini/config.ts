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

/** 單一模型的 token 單價（USD / 每百萬 tokens） */
export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

/**
 * 模型定價表（SDS §11：MODEL_PRICING 設定外置，非寫死在成本計算邏輯）。
 * 數值為 text 用途的官方標準定價（來源：ai.google.dev/gemini-api/docs/pricing，2026-07 查）。
 * Gemini 定價會調整，變更時只改這裡。
 *
 * ⚠️ 連動點：MODEL_TIERS 換用新模型時，務必在此補上該模型的單價，
 *    否則 computeCostUsd 找不到定價會以 0 計算成本（見 finops/costLogger.ts）。
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-3.1-flash-lite": { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
};
