import { apiOk, apiFail } from "@/lib/api/response.ts";
import { handleDescribe } from "@/orchestrator/describeFlow.ts";
import { serializeFlowOutcome } from "@/orchestrator/flowOutcome.ts";
import {
  describeBodySchema,
  sessionIdSchema,
  formatZodError,
} from "@/domains/intake/sessionSchemas.ts";

/**
 * Vercel function 逾時上限（Route Segment Config，僅在 Vercel 生效，本機無作用）。
 * 本路由觸發 Gemini（Parser + 計價），是全 app 最慢的呼叫之一，需要放寬逾時
 * 以免長 LLM 呼叫被 504 截斷（SAD R-1）。
 *
 * 分層預算（設計文件〈延遲預算〉）：本值 180s > agent-service 呼叫逾時 90s
 * > Python agent loop 預算 60s。逾時後仍須留有時間跑完 fallback，故不取滿。
 *
 * 註：Hobby 方案在 Fluid compute 下的上限為 300s（2026-08 查證），
 * 並非早期的 60s。180 是刻意留餘裕的選擇，不是平台限制。
 */
export const maxDuration = 180;

/**
 * POST /api/sessions/{id}/describe — Wizard Step 2 送出描述（SDS §5.1、FR-CW-2）。
 * 觸發 Parser 抽取；齊全則計價出報價、缺欄位則轉等待反問。
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

  const parsed = describeBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const result = await handleDescribe({
      sessionId: idParsed.data,
      rawText: parsed.data.raw_text,
      contactEmail: parsed.data.contact_email,
    });

    if (!result.ok) {
      if (result.error === "not_found") {
        return apiFail("找不到指定的 session", 404);
      }
      return apiFail(
        `session 目前狀態為 ${result.currentStatus}，無法再次送出描述`,
        409,
      );
    }

    return apiOk(serializeFlowOutcome(result.outcome));
  } catch (error) {
    console.error("[POST /api/sessions/:id/describe] 失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
