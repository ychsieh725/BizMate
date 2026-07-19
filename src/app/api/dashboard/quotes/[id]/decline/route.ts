import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { declineQuote } from "@/domains/pricing/quoteActionsService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";

/**
 * POST /api/dashboard/quotes/{id}/decline — 商家婉拒不接的案子。
 * quote_declined 事件落地：原子推進 quotes.status 與 sessions.status → abandoned。
 * 資料保留（不 DELETE），列表預設隱藏、可用狀態 tab 篩回。
 * 404：不存在或非本商家所有；409：狀態機不接受（已確認/已寄出/已婉拒），
 * 或併發下被搶先。
 */
export async function POST(
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
    const result = await declineQuote({
      quoteId: idParsed.data,
      merchantId: auth.merchantId,
    });
    if (!result.ok) {
      return result.reason === "not_found"
        ? apiFail("找不到指定的報價", 404)
        : apiFail("這張報價已確認、已寄出或已婉拒，請重新整理後查看", 409);
    }
    return apiOk({ quote: result.quote });
  } catch (error) {
    console.error("[POST /api/dashboard/quotes/:id/decline] 婉拒失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
