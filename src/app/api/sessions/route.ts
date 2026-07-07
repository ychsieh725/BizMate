import { apiOk, apiFail } from "@/lib/api/response.ts";
import { createSession } from "@/domains/intake/sessionService.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
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
 * POST /api/sessions — Wizard Step 1 建立 session（FR-CW-1）。
 * 公開端點：以同一 IP 每小時上限限流，防灌爆與耗盡 Gemini 額度（NFR-7）。
 * 多租戶入口：body 必帶商家 slug（來自分享連結 /q/{slug}），
 * 查無此商家即 404——這是匿名客戶端取得 tenant context 的唯一途徑。
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
    const merchant = await merchantsRepository.findBySlug(parsed.data.slug);
    if (merchant == null) {
      return apiFail("查無此報價連結", 404);
    }

    const { sessionId, status } = await createSession(
      parsed.data.category,
      merchant.id,
    );
    return apiOk({ session_id: sessionId, status }, 201);
  } catch (error) {
    console.error("[POST /api/sessions] createSession 失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
