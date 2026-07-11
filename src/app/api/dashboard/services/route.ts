import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import { createServiceBodySchema } from "@/domains/pricing/servicesSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";
import { isUniqueViolation } from "@/lib/supabase/errors.ts";

/** GET /api/dashboard/services — 該商家所有服務項目（含已停售）+ 加成規則（唯讀）。 */
export async function GET(): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  try {
    const [items, modifiers] = await Promise.all([
      servicesRepository.findAllByMerchant(auth.merchantId),
      servicesRepository.findModifiersByMerchant(auth.merchantId),
    ]);
    return apiOk({ items, modifiers });
  } catch (error) {
    console.error("[GET /api/dashboard/services] 查詢失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}

/** POST /api/dashboard/services — 新增一筆服務項目（category+subtype 需未重複）。 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = createServiceBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const created = await servicesRepository.create({
      ...parsed.data,
      merchant_id: auth.merchantId,
    });
    return apiOk({ item: created }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiFail("此分類已有相同子類型", 409);
    }
    console.error("[POST /api/dashboard/services] 新增失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
