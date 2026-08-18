import type { SessionStatus } from "@/shared/types/domain.types";
import { transition } from "@/orchestrator/stateMachine.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { rawInputsRepository } from "@/domains/intake/repositories/rawInputsRepository.ts";
import { extractedFieldsRepository } from "@/domains/intake/repositories/extractedFieldsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import { resolveAfterParse, type FlowOutcome } from "@/orchestrator/resolveAfterParse.ts";
import { isAgentLoopEnabled, runAgentOrFallback } from "@/orchestrator/agentFlow.ts";

export type DescribeResult =
  | { readonly ok: true; readonly outcome: FlowOutcome }
  | { readonly ok: false; readonly error: "not_found" }
  | {
      readonly ok: false;
      readonly error: "conflict";
      readonly currentStatus: SessionStatus;
    };

/**
 * POST /describe 的編排（Wizard Step 2）：串接狀態機、Parser、持久化，
 * 解析後的分支（續問 / 計價 / 保守估算）委派給 resolveAfterParse（與 answerFlow 共用）。
 *
 * 流程：載入 session → 檢查可轉移 → 寫 raw_input/email → parsing → 抽取 →
 *       upsert extracted_fields → resolveAfterParse（completedRounds=0，尚未反問過）。
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

  // Agent 路徑（A4，flag 預設關閉）。agent 自行完成抽取與決策；未能完成時
  // runAgentOrFallback 內部退回既有流程，故此處不需要另寫錯誤處理。
  if (isAgentLoopEnabled()) {
    const outcome = await runAgentOrFallback({
      sessionId,
      merchantId: session.merchant_id,
      category: session.category,
      rawText,
      completedRounds: 0,
    });
    return { ok: true, outcome };
  }

  // subtype 的合法值域取自該商家的 rate card（WBS 6.8）。由 orchestrator 查後傳入，
  // 讓 parserAgent 不必依賴 pricing domain——跨域組裝本就是 orchestrator 的職責。
  const allowedServices = await rateCardRepository.findActiveServices(
    session.merchant_id,
    session.category,
  );

  const parsed = await parseIntake({
    sessionId,
    category: session.category,
    rawText,
    allowedServices,
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

  const outcome = await resolveAfterParse({
    sessionId,
    merchantId: session.merchant_id,
    category: session.category,
    fields: parsed.fields,
    missingFields: parsed.missingRequiredFields,
    completedRounds: 0,
  });

  return { ok: true, outcome };
}
