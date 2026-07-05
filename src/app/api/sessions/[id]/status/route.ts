import { apiOk, apiFail } from "@/lib/api/response.ts";
import { getSessionStatus } from "@/domains/intake/sessionService.ts";
import { sessionIdSchema } from "@/domains/intake/sessionSchemas.ts";

/**
 * GET /api/sessions/{id}/status — Wizard 等待畫面輪詢用（SDS §5.1、FR-CW-4）。
 * 只回狀態，不回金額（金額僅接案者於 LINE 端可見）。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const parsed = sessionIdSchema.safeParse(id);
  if (!parsed.success) {
    return apiFail("session id 格式不正確", 400);
  }

  try {
    const status = await getSessionStatus(parsed.data);
    if (status === null) {
      return apiFail("找不到指定的 session", 404);
    }
    return apiOk({ status });
  } catch (error) {
    console.error("[GET /api/sessions/:id/status] 查詢失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
