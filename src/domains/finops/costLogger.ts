import { MODEL_PRICING } from "@/lib/gemini/config.ts";
import {
  generateStructured,
  type GenerateStructuredParams,
} from "@/lib/gemini/generate.ts";
import type {
  GenerateStructuredResult,
  TokenUsage,
} from "@/lib/gemini/types.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";
import { costLogsRepository } from "@/domains/finops/repositories/costLogsRepository.ts";

/**
 * 依模型與 token 用量換算成本（USD）。
 * 找不到模型定價時以 0 計並警告（不中斷主流程）——見 config.ts 的連動點說明。
 */
export function computeCostUsd(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    console.warn(
      `[costLogger] 找不到 ${model} 的定價，成本以 0 記錄。請於 MODEL_PRICING 補上。`,
    );
    return 0;
  }
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * 將一次 LLM 呼叫的成本寫入 cost_logs（FR-FO-1、SDS §9.3）。
 * best-effort：可觀測性不應中斷業務流程，寫入失敗只記錄錯誤、回傳 null。
 */
export async function logCost(params: {
  sessionId: string | null;
  agentName: string;
  result: Pick<GenerateStructuredResult<unknown>, "model" | "usage" | "latencyMs">;
}): Promise<Tables<"cost_logs"> | null> {
  const { sessionId, agentName, result } = params;
  try {
    return await costLogsRepository.create({
      session_id: sessionId,
      agent_name: agentName,
      model: result.model,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      cost_usd: computeCostUsd(result.model, result.usage),
      latency_ms: result.latencyMs,
    });
  } catch (error) {
    console.error("[costLogger] 寫入 cost_logs 失敗（不中斷主流程）：", error);
    return null;
  }
}

/**
 * 呼叫 Gemini 並自動記錄成本——各 Agent 應使用此入口，而非直接呼叫
 * generateStructured，確保「每次 LLM 呼叫都留下 cost_logs」（SDS §9.3）。
 */
export async function generateStructuredAndLog<T>(
  params: GenerateStructuredParams<T> & {
    sessionId: string | null;
    agentName: string;
  },
): Promise<GenerateStructuredResult<T>> {
  const { sessionId, agentName, ...genParams } = params;
  const result = await generateStructured<T>(genParams);
  await logCost({ sessionId, agentName, result });
  return result;
}
