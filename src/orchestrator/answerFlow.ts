import type { SessionStatus } from "@/shared/types/domain.types";
import { transition } from "@/orchestrator/stateMachine.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { rawInputsRepository } from "@/domains/intake/repositories/rawInputsRepository.ts";
import { extractedFieldsRepository } from "@/domains/intake/repositories/extractedFieldsRepository.ts";
import { clarificationTurnsRepository } from "@/domains/intake/repositories/clarificationTurnsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import { resolveAfterParse, type FlowOutcome } from "@/orchestrator/resolveAfterParse.ts";

/** 客戶對某一反問欄位的回答（批次：一輪回答多個欄位）。 */
export interface ClarificationAnswer {
  readonly field: string;
  readonly answer: string;
}

export type AnswerResult =
  | { readonly ok: true; readonly outcome: FlowOutcome }
  | { readonly ok: false; readonly error: "not_found" }
  | {
      readonly ok: false;
      readonly error: "conflict";
      readonly currentStatus: SessionStatus;
    }
  | { readonly ok: false; readonly error: "no_pending_question" };

/**
 * 組合「原始描述 + 已答問答」作為重新解析的輸入文字。
 * 讓 Parser 在完整上下文（含客戶對反問的所有回答）下重抽全部欄位。
 */
function buildAugmentedText(
  rawText: string,
  answeredTurns: readonly { question: string; answer: string | null }[],
): string {
  if (answeredTurns.length === 0) return rawText;
  const qa = answeredTurns
    .map((turn) => `問：${turn.question}\n答：${turn.answer ?? ""}`)
    .join("\n");
  return `${rawText}\n\n補充問答：\n${qa}`;
}

/**
 * POST /answer 的編排（Wizard Step 3 回答反問）：一次填入本輪所有欄位的答案、
 * 以「原始描述 + 累積問答」重新解析，再委派 resolveAfterParse 決定續問 /
 * 出報價 / 保守估算。
 *
 * 狀態機：awaiting_clarification --answer_submitted--> parsing，之後分支由
 * resolveAfterParse 依 missingFields 與「已答輪數」決定（FR-CL-1~3）。
 * 已答輪數 = 已回答 turn 的相異 round 數（批次下一輪含多筆 turn）。
 */
export async function handleAnswer(params: {
  sessionId: string;
  answers: readonly ClarificationAnswer[];
}): Promise<AnswerResult> {
  const { sessionId, answers } = params;

  const session = await sessionsRepository.findById(sessionId);
  if (session == null) {
    return { ok: false, error: "not_found" };
  }

  // 只有 awaiting_clarification 能接受回答
  const toParsing = transition(session.status, "answer_submitted");
  if (!toParsing.ok) {
    return { ok: false, error: "conflict", currentStatus: session.status };
  }

  // 本輪所有待回答的反問；找不到代表狀態不一致
  const pending = await clarificationTurnsRepository.findUnanswered(sessionId);
  if (pending.length === 0) {
    return { ok: false, error: "no_pending_question" };
  }

  // 依 triggered_field 對應填入每一題的答案（順序無關，用欄位對映）
  const answerByField = new Map(answers.map((a) => [a.field, a.answer]));
  for (const turn of pending) {
    const answer = answerByField.get(turn.triggered_field);
    if (answer !== undefined) {
      await clarificationTurnsRepository.update(turn.id, { answer });
    }
  }

  await sessionsRepository.update(sessionId, { status: toParsing.state });

  const raw = await rawInputsRepository.findLatestBySession(sessionId);
  const answeredTurns =
    await clarificationTurnsRepository.findAnsweredOrdered(sessionId);
  const augmentedText = buildAugmentedText(raw?.raw_text ?? "", answeredTurns);

  // 與 describeFlow 同：subtype 值域取自該商家 rate card（WBS 6.8）。反問後的
  // 補答同樣需要值域約束——客戶回「海報」時仍須映射到「海報文宣」才查得到表。
  const allowedSubtypes = await rateCardRepository.findActiveSubtypes(
    session.merchant_id,
    session.category,
  );

  const parsed = await parseIntake({
    sessionId,
    category: session.category,
    rawText: augmentedText,
    allowedSubtypes,
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

  const completedRounds = new Set(answeredTurns.map((turn) => turn.round)).size;
  const outcome = await resolveAfterParse({
    sessionId,
    merchantId: session.merchant_id,
    category: session.category,
    fields: parsed.fields,
    missingFields: parsed.missingRequiredFields,
    completedRounds,
  });

  return { ok: true, outcome };
}
