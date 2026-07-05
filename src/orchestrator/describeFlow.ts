import type { SessionStatus } from "@/shared/types/domain.types";
import { transition } from "@/orchestrator/stateMachine.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { rawInputsRepository } from "@/domains/intake/repositories/rawInputsRepository.ts";
import { extractedFieldsRepository } from "@/domains/intake/repositories/extractedFieldsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import { generateQuoteCode } from "@/domains/pricing/quoteFormatter.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";
import { priceLineItemsRepository } from "@/domains/pricing/repositories/priceLineItemsRepository.ts";

/** /describe 的處理結果（對應 SDS §5.1 的兩種回應）。 */
export interface DescribeOutcome {
  readonly status: SessionStatus;
  /** 缺欄位路徑：列出缺哪些必要欄位（question 由 4.1 Clarification 補上）。 */
  readonly missingFields?: string[];
  /** 齊全路徑：配發的報價編號。 */
  readonly quoteCode?: string;
  /** 齊全路徑：是否超出 rate card 範圍（需人工評估）。 */
  readonly outOfScope?: boolean;
}

export type DescribeResult =
  | { readonly ok: true; readonly outcome: DescribeOutcome }
  | { readonly ok: false; readonly error: "not_found" }
  | {
      readonly ok: false;
      readonly error: "conflict";
      readonly currentStatus: SessionStatus;
    };

/** 內部不變量：對已知合法的轉移取下一狀態，不合法代表程式邏輯錯誤。 */
function nextState(current: SessionStatus, event: Parameters<typeof transition>[1]): SessionStatus {
  const result = transition(current, event);
  if (!result.ok) {
    throw new Error(`describeFlow 內部非法轉移：${current} + ${event}`);
  }
  return result.state;
}

/**
 * POST /describe 的編排（Wizard Step 2）：串接狀態機、Parser、報價鏈與持久化。
 *
 * 流程：載入 session → 檢查可轉移 → 寫 raw_input/email → parsing → 抽取 →
 * upsert extracted_fields →
 *   ├ 缺欄位 → awaiting_clarification（回 missingFields）
 *   └ 齊全   → pricing → 計價 → 寫 quotes/price_line_items → awaiting_freelancer
 *
 * 註：多筆寫入非原子（P0 不做分散式事務）；Parser/計價拋錯會往上拋，
 * 由 route 回 500，session 停於當時狀態（未來靠 timeout→abandoned 回收）。
 */
export async function handleDescribe(params: {
  sessionId: string;
  rawText: string;
  contactEmail: string;
}): Promise<DescribeResult> {
  const { sessionId, rawText, contactEmail } = params;

  const session = await sessionsRepository.findById(sessionId);
  if (session == null) {
    return { ok: false, error: "not_found" };
  }

  // 只有 created 能接受描述；其餘狀態代表已描述過或流程已推進
  const toParsing = transition(session.status, "describe_submitted");
  if (!toParsing.ok) {
    return { ok: false, error: "conflict", currentStatus: session.status };
  }

  await rawInputsRepository.create({ session_id: sessionId, raw_text: rawText });
  await sessionsRepository.update(sessionId, {
    contact_email: contactEmail,
    status: toParsing.state,
  });

  const parsed = await parseIntake({
    sessionId,
    category: session.category,
    rawText,
  });

  await extractedFieldsRepository.upsertMany(
    Object.entries(parsed.fields).map(([fieldName, field]) => ({
      session_id: sessionId,
      field_name: fieldName,
      value: field.value,
      confidence: field.confidence,
      source_span: field.source_span,
    })),
  );

  // 缺欄位 → 等待反問（P0 只回缺漏清單，question 待 4.1）
  if (parsed.missingRequiredFields.length > 0) {
    const status = nextState("parsing", "parse_incomplete");
    await sessionsRepository.update(sessionId, { status });
    return {
      ok: true,
      outcome: { status, missingFields: parsed.missingRequiredFields },
    };
  }

  // 齊全 → 計價出報價
  await sessionsRepository.update(sessionId, {
    status: nextState("parsing", "parse_complete"),
  });

  const pricing = await computeBasePricing(session.category, parsed.fields);
  const quoteCode = await generateQuoteCode(session.category);

  await quotesRepository.create({
    session_id: sessionId,
    quote_code: quoteCode,
    final_amount: pricing.outOfScope ? null : pricing.total,
    status: "awaiting_freelancer",
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

  return {
    ok: true,
    outcome: { status, quoteCode, outOfScope: pricing.outOfScope },
  };
}
