import { apiOk, apiFail } from "@/lib/api/response.ts";
import { createSession } from "@/domains/intake/sessionService.ts";
import {
  createSessionBodySchema,
  formatZodError,
} from "@/domains/intake/sessionSchemas.ts";
import {
  checkRateLimit,
  getClientIp,
  SESSION_CREATE_RULE,
} from "@/lib/rateLimit/rateLimit.ts";

/**
 * POST /api/sessions — Wizard Step 1 建立 session（SDS §5.1、FR-CW-1）。
 * 公開端點：以同一 IP 每小時上限限流，防灌爆與耗盡 Gemini 額度（NFR-7）。
 */
export async function POST(request: Request): Promise<Response> {
  const { allowed } = await checkRateLimit(
    `sessions:${getClientIp(request)}`,
    SESSION_CREATE_RULE,
  );
  if (!allowed) {
    return apiFail("請求過於頻繁，請稍後再試", 429);
  }

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
