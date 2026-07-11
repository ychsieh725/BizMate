import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";

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
