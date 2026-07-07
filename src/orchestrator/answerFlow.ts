import type { SessionStatus } from "@/shared/types/domain.types";
import { transition } from "@/orchestrator/stateMachine.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { rawInputsRepository } from "@/domains/intake/repositories/rawInputsRepository.ts";
import { extractedFieldsRepository } from "@/domains/intake/repositories/extractedFieldsRepository.ts";
import { clarificationTurnsRepository } from "@/domains/intake/repositories/clarificationTurnsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { resolveAfterParse, type FlowOutcome } from "@/orchestrator/resolveAfterParse.ts";

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
 * 讓 Parser 在完整上下文（含客戶對反問的回答）下重抽所有欄位，而非只補單一欄位。
 */
async function buildAugmentedText(sessionId: string): Promise<string> {
  const raw = await rawInputsRepository.findLatestBySession(sessionId);
  const turns = await clarificationTurnsRepository.findAnsweredOrdered(sessionId);
  const base = raw?.raw_text ?? "";
  if (turns.length === 0) return base;

  const qa = turns
    .map((turn) => `問：${turn.question}\n答：${turn.answer}`)
    .join("\n");
  return `${base}\n\n補充問答：\n${qa}`;
}

/**
 * POST /answer 的編排（Wizard Step 3 回答反問）：填入本輪答案、以「原始描述 +
 * 累積問答」重新解析，再委派 resolveAfterParse 決定續問 / 出報價 / 保守估算。
 *
 * 狀態機：awaiting_clarification --answer_submitted--> parsing，之後分支由
 * resolveAfterParse 依 missingFields 與已答輪數決定（FR-CL-1~3）。
 */
export async function handleAnswer(params: {
  sessionId: string;
  answer: string;
}): Promise<AnswerResult> {
  const { sessionId, answer } = params;

  const session = await sessionsRepository.findById(sessionId);
  if (session == null) {
    return { ok: false, error: "not_found" };
  }

  // 只有 awaiting_clarification 能接受回答
  const toParsing = transition(session.status, "answer_submitted");
  if (!toParsing.ok) {
    return { ok: false, error: "conflict", currentStatus: session.status };
  }

  // 填入本輪答案；找不到待回答的反問代表狀態不一致
  const turn = await clarificationTurnsRepository.findUnansweredLatest(sessionId);
  if (turn == null) {
    return { ok: false, error: "no_pending_question" };
  }
  await clarificationTurnsRepository.update(turn.id, { answer });

  await sessionsRepository.update(sessionId, { status: toParsing.state });

  const augmentedText = await buildAugmentedText(sessionId);
  const parsed = await parseIntake({
    sessionId,
    category: session.category,
    rawText: augmentedText,
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

  const completedRounds = await clarificationTurnsRepository.countAnswered(sessionId);
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
