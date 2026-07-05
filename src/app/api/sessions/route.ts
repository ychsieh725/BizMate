import { apiOk, apiFail } from "@/lib/api/response.ts";
import { createSession } from "@/domains/intake/sessionService.ts";
import {
  createSessionBodySchema,
  formatZodError,
} from "@/domains/intake/sessionSchemas.ts";

/**
 * POST /api/sessions — Wizard Step 1 建立 session（SDS §5.1、FR-CW-1）。
 * 公開端點；rate limiting 由任務 3.7 另加。
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = createSessionBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const { sessionId, status } = await createSession(parsed.data.category);
    return apiOk({ session_id: sessionId, status }, 201);
  } catch (error) {
    console.error("[POST /api/sessions] createSession 失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
