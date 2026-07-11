import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { sendQuoteEmail } from "@/domains/pricing/quoteActionsService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";

/**
 * POST /api/dashboard/quotes/{id}/send — 寄送最終報價單給客戶。
 * email_sent 事件落地：Resend 送出成功後才原子推進 quotes.status/sessions.status
 * → sent。本端點天然冪等：在 confirmed 狀態下重複呼叫即是「重寄」機制。
 * 404：不存在或非本商家所有；409：報價不在 confirmed（未確認或已寄出）；
 * 502：Resend API 呼叫失敗（外部服務錯誤，與系統忙碌的 500 區分）。
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
    const result = await sendQuoteEmail({
      quoteId: idParsed.data,
      merchantId: auth.merchantId,
    });
    if (!result.ok) {
      if (result.reason === "not_found") {
        return apiFail("找不到指定的報價", 404);
      }
      if (result.reason === "email_failed") {
        return apiFail(`Email 寄送失敗：${result.message}`, 502);
      }
      return apiFail("這張報價尚未確認或已寄出", 409);
    }
    return apiOk({ quote: result.quote });
  } catch (error) {
    console.error("[POST /api/dashboard/quotes/:id/send] 寄送失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
