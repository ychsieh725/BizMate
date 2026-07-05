import type { CaseCategory, SessionStatus } from "@/shared/types/domain.types";
import { transition } from "@/orchestrator/stateMachine.ts";
import type { FieldExtraction } from "@/domains/intake/parserFields.ts";
import {
  selectNextField,
  canAskMoreClarifications,
} from "@/domains/intake/clarificationFields.ts";
import { generateClarificationQuestion } from "@/domains/intake/clarificationAgent.ts";
import { clarificationTurnsRepository } from "@/domains/intake/repositories/clarificationTurnsRepository.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import { generateQuoteCode } from "@/domains/pricing/quoteFormatter.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";
import { priceLineItemsRepository } from "@/domains/pricing/repositories/priceLineItemsRepository.ts";
import type { FlowOutcome } from "@/orchestrator/flowOutcome.ts";

export type { FlowOutcome };

/** 內部不變量：對已知合法的轉移取下一狀態，不合法代表程式邏輯錯誤。 */
export function nextState(
  current: SessionStatus,
  event: Parameters<typeof transition>[1],
): SessionStatus {
  const result = transition(current, event);
  if (!result.ok) {
    throw new Error(`orchestrator 內部非法轉移：${current} + ${event}`);
  }
  return result.state;
}

/**
 * 解析（Parser）之後的統一分支決策，供 describeFlow 與 answerFlow 共用（DRY）。
 * 前提：呼叫時 session 已在 `parsing` 狀態、extracted_fields 已 upsert。
 *
 *   ├ 有缺 & 未達輪數上限 → 選下一題、生成問題、寫 turn → awaiting_clarification
 *   ├ 有缺 & 已達輪數上限 → 保守估算（用現有缺漏 fields 計價）→ awaiting_freelancer
 *   └ 齊全               → 正常計價 → awaiting_freelancer
 */
export async function resolveAfterParse(params: {
  sessionId: string;
  category: CaseCategory;
  fields: Record<string, FieldExtraction>;
  missingFields: string[];
  completedRounds: number;
}): Promise<FlowOutcome> {
  const { sessionId, category, fields, missingFields, completedRounds } = params;

  // 續問路徑：仍缺欄位且未達輪數上限 → 生成下一題
  if (missingFields.length > 0 && canAskMoreClarifications(completedRounds)) {
    const targetField = selectNextField(missingFields);
    if (targetField == null) {
      throw new Error("resolveAfterParse：missingFields 非空但選不出欄位");
    }

    const { question } = await generateClarificationQuestion({
      sessionId,
      category,
      targetField,
    });

    await clarificationTurnsRepository.create({
      session_id: sessionId,
      round: completedRounds + 1,
      question,
      triggered_field: targetField,
    });

    const status = nextState("parsing", "parse_incomplete");
    await sessionsRepository.update(sessionId, { status });
    return { status, missingFields, question, targetField };
  }

  // 出報價路徑：齊全（正常）或缺欄位但輪數用盡（保守估算）
  const conservative = missingFields.length > 0;
  const pricingState = conservative
    ? nextState(nextState("parsing", "parse_incomplete"), "clarification_exhausted")
    : nextState("parsing", "parse_complete");
  await sessionsRepository.update(sessionId, { status: pricingState });

  const pricing = await computeBasePricing(category, fields);
  const quoteCode = await generateQuoteCode(category);

  await quotesRepository.create({
    session_id: sessionId,
    quote_code: quoteCode,
    final_amount: pricing.outOfScope ? null : pricing.total,
    status: "awaiting_freelancer",
    is_conservative: conservative,
  });

  await priceLineItemsRepository.createMany(
    pricing.lineItems.map((item) => ({
      session_id: sessionId,
      item_name: item.itemName,
      amount: item.amount,
      rule_id: item.ruleId,
      modifier_id: item.modifierId,
      agent_reasoning: item.agentReasoning,
    })),
  );

  const status = nextState("pricing", "pricing_done");
  await sessionsRepository.update(sessionId, { status });
  return { status, quoteCode, outOfScope: pricing.outOfScope, conservative };
}
