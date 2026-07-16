import type { CaseCategory, SessionStatus } from "@/shared/types/domain.types";
import { transition } from "@/orchestrator/stateMachine.ts";
import type { FieldExtraction } from "@/domains/intake/parserFields.ts";
import {
  orderMissingFields,
  canAskMoreClarifications,
} from "@/domains/intake/clarificationFields.ts";
import { generateClarificationQuestions } from "@/domains/intake/clarificationAgent.ts";
import { clarificationTurnsRepository } from "@/domains/intake/repositories/clarificationTurnsRepository.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import { generateQuoteCode } from "@/domains/pricing/quoteFormatter.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";
import { priceLineItemsRepository } from "@/domains/pricing/repositories/priceLineItemsRepository.ts";
import type { FlowOutcome } from "@/orchestrator/flowOutcome.ts";
import { isUniqueViolation } from "@/lib/supabase/errors.ts";

export type { FlowOutcome };

/**
 * 產生 quote_code 並寫入報價；撞到 UNIQUE (merchant_id, quote_code) 時重新取號
 * 重試一次（併發下兩筆同時取到相同流水號的情況）。MVP 流量下夠用，
 * 不做 counter 表 + RPC。
 */
async function createQuoteWithRetry(params: {
  sessionId: string;
  merchantId: string;
  category: CaseCategory;
  finalAmount: number | null;
  conservative: boolean;
}): Promise<string> {
  const { sessionId, merchantId, category, finalAmount, conservative } = params;

  const insertQuote = async (quoteCode: string) =>
    quotesRepository.create({
      session_id: sessionId,
      merchant_id: merchantId,
      quote_code: quoteCode,
      final_amount: finalAmount,
      status: "awaiting_review",
      is_conservative: conservative,
    });

  const firstCode = await generateQuoteCode(merchantId, category);
  try {
    await insertQuote(firstCode);
    return firstCode;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const retryCode = await generateQuoteCode(merchantId, category);
    await insertQuote(retryCode);
    return retryCode;
  }
}

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
 * merchantId 來自 session（入口以 slug 解析一次後掛上），計價與流水號皆以其為範圍。
 *
 *   ├ 有缺 & 未達輪數上限 → 選下一題、生成問題、寫 turn → awaiting_clarification
 *   ├ 有缺 & 已達輪數上限 → 保守估算（用現有缺漏 fields 計價）→ awaiting_review
 *   └ 齊全               → 正常計價 → awaiting_review
 */
export async function resolveAfterParse(params: {
  sessionId: string;
  merchantId: string;
  category: CaseCategory;
  fields: Record<string, FieldExtraction>;
  missingFields: string[];
  completedRounds: number;
}): Promise<FlowOutcome> {
  const { sessionId, merchantId, category, fields, missingFields, completedRounds } =
    params;

  // 續問路徑：仍缺欄位且未達輪數上限 → 一次生成本輪全部問題（批次反問）
  if (missingFields.length > 0 && canAskMoreClarifications(completedRounds)) {
    const orderedFields = orderMissingFields(missingFields);
    const questions = await generateClarificationQuestions({
      sessionId,
      category,
      targetFields: orderedFields,
    });

    // 本輪所有欄位共用同一個 round 號（clarification_turns 對 round 無唯一約束）
    const round = completedRounds + 1;
    for (const item of questions) {
      await clarificationTurnsRepository.create({
        session_id: sessionId,
        round,
        question: item.question,
        triggered_field: item.targetField,
      });
    }

    const status = nextState("parsing", "parse_incomplete");
    await sessionsRepository.update(sessionId, { status });
    return { status, missingFields, questions };
  }

  // 出報價路徑：齊全（正常）或缺欄位但輪數用盡（保守估算）
  const conservative = missingFields.length > 0;
  const pricingState = conservative
    ? nextState(nextState("parsing", "parse_incomplete"), "clarification_exhausted")
    : nextState("parsing", "parse_complete");
  await sessionsRepository.update(sessionId, { status: pricingState });

  const pricing = await computeBasePricing(merchantId, category, fields);
  const quoteCode = await createQuoteWithRetry({
    sessionId,
    merchantId,
    category,
    finalAmount: pricing.outOfScope ? null : pricing.total,
    conservative,
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
