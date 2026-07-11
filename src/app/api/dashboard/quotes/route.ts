import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { listQuotesQuerySchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";

/** GET /api/dashboard/quotes?status= — 該商家報價列表；status 選填，未帶則回全部。 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  const statusParam = new URL(request.url).searchParams.get("status");
  const parsed = listQuotesQuerySchema.safeParse(
    statusParam === null ? {} : { status: statusParam },
  );
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const items = await listQuotes(auth.merchantId, parsed.data.status);
    return apiOk({ items });
  } catch (error) {
    console.error("[GET /api/dashboard/quotes] 查詢失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
