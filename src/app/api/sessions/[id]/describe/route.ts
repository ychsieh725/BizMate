import { apiOk, apiFail } from "@/lib/api/response.ts";
import { handleDescribe } from "@/orchestrator/describeFlow.ts";
import {
  describeBodySchema,
  sessionIdSchema,
  formatZodError,
} from "@/domains/intake/sessionSchemas.ts";

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

    const { outcome } = result;
    return apiOk({
      status: outcome.status,
      ...(outcome.missingFields
        ? { missing_fields: outcome.missingFields }
        : {}),
      ...(outcome.quoteCode ? { quote_code: outcome.quoteCode } : {}),
      ...(outcome.outOfScope !== undefined
        ? { out_of_scope: outcome.outOfScope }
        : {}),
    });
  } catch (error) {
    console.error("[POST /api/sessions/:id/describe] 失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
