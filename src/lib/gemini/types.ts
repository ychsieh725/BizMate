/** Gemini 呼叫的 token 用量（供 FinOps 成本計算，任務 2.6 / FR-FO-1） */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/** 結構化生成的結果：驗證後的資料 + 可觀測性中繼資料 */
export type GenerateStructuredResult<T> = {
  data: T;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
};
