import type { CaseCategory } from "@/shared/types/domain.types";
import { callAgentService } from "@/lib/agentService.ts";
import { extractedFieldsRepository } from "@/domains/intake/repositories/extractedFieldsRepository.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { nextState, resolveAfterParse } from "@/orchestrator/resolveAfterParse.ts";
import type { FlowOutcome } from "@/orchestrator/flowOutcome.ts";
import {
  isFieldMissing,
  requiredFieldsFor,
  type FieldExtraction,
} from "@/domains/intake/parserFields.ts";

/**
 * agent-service 的編排接縫。
 *
 * 職責分工（設計文件〈與狀態機的接縫〉）：
 * - **Python 決定**「下一步做什麼」，回傳一個既有的 SessionEvent
 * - **TypeScript 執行**狀態轉移與持久化
 *
 * 狀態機仍是 TS 端的單一事實來源，transitions.ts 一行未改。
 *
 * 不變式 I-3：agent 未能完成時（服務不通、預算耗盡、迴圈偵測…），
 * 一律退回既有的 resolveAfterParse，產出與 agent 化之前完全一致的結果。
 * **agent 是加值層，不是必經路徑。**
 */

/** agent-service 的回應形狀（對應 Python 端 /agent/resolve）。 */
type AgentResolveData = {
  outcome: "completed" | "fallback";
  event: "parse_complete" | "parse_incomplete" | null;
  run_id: string;
  steps_taken: number;
  total_latency_ms: number;
  total_cost_usd: number;
  tool_result: {
    questions?: { target_field: string; question: string }[];
  } | null;
  fallback_reason: string | null;
};

/**
 * agent 是否啟用。
 *
 * 只有明確設為 "true" 才啟用——任何其他值（含未設定、"1"、"yes"）都視為關閉。
 * feature flag 的預設值應該是「維持現狀」，模糊的真值判斷會讓設定錯誤悄悄
 * 開啟一條未驗證的路徑。
 */
export function isAgentLoopEnabled(): boolean {
  return process.env.AGENT_LOOP_ENABLED === "true";
}

/** 讀回 agent 已寫入的欄位，作為 fallback 的起點。 */
async function loadStoredFields(
  sessionId: string,
): Promise<Record<string, FieldExtraction>> {
  const rows = await extractedFieldsRepository.findBySession(sessionId);
  return Object.fromEntries(
    rows.map((row) => [
      row.field_name,
      {
        value: row.value,
        confidence: Number(row.confidence ?? 0),
        source_span: row.source_span,
      },
    ]),
  );
}

/**
 * agent 決定續問時的處置。
 *
 * 問題已由 Python 端寫入 clarification_turns，此處**不得再呼叫
 * resolveAfterParse**——那會重新生成一輪問題並寫入重複的 turn。
 * 只需推進狀態並把問題交給客戶端。
 */
async function applyClarification(
  sessionId: string,
  data: AgentResolveData,
): Promise<FlowOutcome> {
  const questions = (data.tool_result?.questions ?? []).map((item) => ({
    question: item.question,
    targetField: item.target_field,
  }));

  const status = nextState("parsing", "parse_incomplete");
  await sessionsRepository.update(sessionId, { status });

  return {
    status,
    missingFields: questions.map((item) => item.targetField),
    questions,
  };
}

export type AgentFlowParams = {
  sessionId: string;
  merchantId: string;
  category: CaseCategory;
  rawText: string;
  completedRounds: number;
  priorAnswers?: { question: string; answer: string }[];
};

/**
 * 嘗試以 agent 處理；未能完成則退回既有流程。
 *
 * 回傳的 FlowOutcome 與既有路徑同形，呼叫端不需要知道這次是走 agent 還是
 * fallback——這正是 I-3 的意義：agent 的存在與否對上層透明。
 */
export async function runAgentOrFallback(
  params: AgentFlowParams,
): Promise<FlowOutcome> {
  const { sessionId, merchantId, category, rawText, completedRounds } = params;

  const fallback = async (): Promise<FlowOutcome> => {
    const fields = await loadStoredFields(sessionId);
    // 用既有邏輯重新判斷缺漏——不沿用 agent 的判斷，因為走到這裡正代表
    // 它的判斷不可信（或根本沒來得及判斷）。
    const missingFields = requiredFieldsFor(category).filter((name) =>
      isFieldMissing(fields[name]),
    );

    return resolveAfterParse({
      sessionId,
      merchantId,
      category,
      fields,
      missingFields,
      completedRounds,
    });
  };

  const result = await callAgentService<AgentResolveData>("/agent/resolve", {
    session_id: sessionId,
    merchant_id: merchantId,
    category,
    raw_text: rawText,
    completed_rounds: completedRounds,
    prior_answers: params.priorAnswers ?? [],
  });

  if (!result.ok) {
    console.warn(
      `[agentFlow] agent-service 不可用（${result.reason}），改走既有流程：${result.detail}`,
    );
    return fallback();
  }

  if (result.data.outcome === "fallback") {
    console.info(
      `[agentFlow] agent 交棒（${result.data.fallback_reason}），改走既有流程`,
    );
    return fallback();
  }

  if (result.data.event === "parse_incomplete") {
    return applyClarification(sessionId, result.data);
  }

  // parse_complete：欄位已由 agent 寫入且判定齊全，走既有的出報價路徑。
  // 傳空的 missingFields 讓 resolveAfterParse 進入計價分支——報價的建立、
  // 流水號、明細持久化全部重用既有程式碼，不另寫一套。
  const fields = await loadStoredFields(sessionId);
  return resolveAfterParse({
    sessionId,
    merchantId,
    category,
    fields,
    missingFields: [],
    completedRounds,
  });
}
