import { apiOk, apiFail } from "@/lib/api/response.ts";
import { handleAnswer } from "@/orchestrator/answerFlow.ts";
import { serializeFlowOutcome } from "@/orchestrator/flowOutcome.ts";
import {
  answerBodySchema,
  sessionIdSchema,
  formatZodError,
} from "@/domains/intake/sessionSchemas.ts";

/**
 * POST /api/sessions/{id}/answer — Wizard Step 3 回答反問（SDS §5.1、FR-CL-1）。
 * 填入答案 → 以「原始描述 + 累積問答」重新解析 → 再問一輪 / 出報價 / 保守估算。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const idParsed = sessionIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("session id 格式不正確", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = answerBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const result = await handleAnswer({
      sessionId: idParsed.data,
      answer: parsed.data.answer,
    });

    if (!result.ok) {
      if (result.error === "not_found") {
        return apiFail("找不到指定的 session", 404);
      }
      if (result.error === "no_pending_question") {
        return apiFail("目前沒有待回答的問題", 409);
      }
      return apiFail(
        `session 目前狀態為 ${result.currentStatus}，無法回答反問`,
        409,
      );
    }

    return apiOk(serializeFlowOutcome(result.outcome));
  } catch (error) {
    console.error("[POST /api/sessions/:id/answer] 失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
