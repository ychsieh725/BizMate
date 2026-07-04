import { z } from "zod";
import { getGeminiClient } from "@/lib/gemini/client.ts";
import { MODEL_TIERS, type ModelTier } from "@/lib/gemini/config.ts";
import type {
  GenerateStructuredResult,
  TokenUsage,
} from "@/lib/gemini/types.ts";

/** Gemini 呼叫錯誤，帶模型與原始訊息上下文 */
export class GeminiError extends Error {
  constructor(
    readonly model: string,
    readonly detail: string,
  ) {
    super(`[gemini:${model}] ${detail}`);
    this.name = "GeminiError";
  }
}

/** 逾時/失敗重試次數（SDS §12：重試 1 次，指數退避） */
const MAX_RETRIES = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 從 usageMetadata 萃取 token 用量，欄位缺漏一律以 0 補（不讓成本記錄崩） */
function extractUsage(
  metadata:
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined,
): TokenUsage {
  const inputTokens = metadata?.promptTokenCount ?? 0;
  const outputTokens = metadata?.candidatesTokenCount ?? 0;
  const totalTokens = metadata?.totalTokenCount ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * 以結構化輸出呼叫 Gemini。
 *
 * 一份 zod schema 三用：
 * 1. 產生 Gemini 的 responseJsonSchema（強制模型回傳指定 JSON 形狀）
 * 2. 驗證回傳內容（runtime 型別安全，coding-style「驗證外部資料」）
 * 3. 推導 TypeScript 型別（呼叫端拿到 T）
 *
 * 失敗（含逾時、malformed 輸出）重試 1 次並指數退避；仍失敗拋 GeminiError。
 */
export async function generateStructured<T>(params: {
  tier: ModelTier;
  prompt: string;
  schema: z.ZodType<T>;
  systemInstruction?: string;
}): Promise<GenerateStructuredResult<T>> {
  const { tier, prompt, schema, systemInstruction } = params;
  const model = MODEL_TIERS[tier];
  const jsonSchema = z.toJSONSchema(schema);
  const client = getGeminiClient();

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(2 ** attempt * 200);
    }
    try {
      const startedAt = Date.now();
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
        },
      });
      const latencyMs = Date.now() - startedAt;

      const text = response.text;
      if (!text) {
        throw new Error("Gemini 回應無文字內容");
      }

      const data = schema.parse(JSON.parse(text));
      const usage = extractUsage(response.usageMetadata);
      return { data, model, usage, latencyMs };
    } catch (error) {
      lastError = error;
    }
  }

  throw new GeminiError(
    model,
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}
