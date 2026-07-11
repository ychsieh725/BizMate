import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { adjustQuoteAmount } from "@/domains/pricing/quoteActionsService.ts";
import { adjustAmountBodySchema } from "@/domains/pricing/quoteActionsSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";

/**
 * GET /api/dashboard/quotes/{id} — 單張報價的完整脈絡。
 * 不存在與非本商家所有一律回 404（不回 403：不洩漏資源存在性，
 * 同 services/[id] 的 findOwnedService 慣例）。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  const { id } = await params;
  const idParsed = quoteIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("報價 id 格式不正確", 400);
  }

  try {
    const detail = await getQuoteDetail(idParsed.data, auth.merchantId);
    if (detail === null) {
      return apiFail("找不到指定的報價", 404);
    }
    return apiOk({ detail });
  } catch (error) {
    console.error("[GET /api/dashboard/quotes/:id] 查詢失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}

/**
 * PATCH /api/dashboard/quotes/{id} — 調整最終金額（限 awaiting_review）。
 * 404：不存在或非本商家所有；409：報價已確認/已寄出，或併發下被搶先。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  const { id } = await params;
  const idParsed = quoteIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("報價 id 格式不正確", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = adjustAmountBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const result = await adjustQuoteAmount({
      quoteId: idParsed.data,
      merchantId: auth.merchantId,
      finalAmount: parsed.data.final_amount,
    });
    if (!result.ok) {
      return result.reason === "not_found"
        ? apiFail("找不到指定的報價", 404)
        : apiFail("這張報價已確認或寄出，無法再調整金額", 409);
    }
    return apiOk({ quote: result.quote });
  } catch (error) {
    console.error("[PATCH /api/dashboard/quotes/:id] 調整金額失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
