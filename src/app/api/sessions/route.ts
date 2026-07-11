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
 * 公開端點：雙桶限流防灌爆與耗盡 Gemini 額度（NFR-7、5.9 補洞）——
 * IP 桶防同一來源打多個商家，slug 桶防同一商家被大量不同來源灌爆
 * （只有 IP 桶時，殭屍網路/共用 NAT 可繞過）。任一桶超限即擋。
 * 多租戶入口：body 必帶商家 slug（來自分享連結 /q/{slug}），
 * 查無此商家即 404——這是匿名客戶端取得 tenant context 的唯一途徑。
 */
export async function POST(request: Request): Promise<Response> {
  const { allowed: ipAllowed } = await checkRateLimit(
    `sessions:ip:${getClientIp(request)}`,
    SESSION_CREATE_RULE,
  );
  if (!ipAllowed) {
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

  // slug 桶獨立於 IP 桶：防同一 slug 被大量不同來源（殭屍網路/共用 NAT）灌爆，
  // 這在只有 IP 桶時完全沒有防護。body 驗證通過後才知道 slug，故此檢查排在此處。
  const { allowed: slugAllowed } = await checkRateLimit(
    `sessions:slug:${parsed.data.slug}`,
    SESSION_CREATE_RULE,
  );
  if (!slugAllowed) {
    return apiFail("請求過於頻繁，請稍後再試", 429);
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
