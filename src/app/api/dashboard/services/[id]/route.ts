import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import {
  serviceIdSchema,
  updateServiceBodySchema,
} from "@/domains/pricing/servicesSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * 歸屬檢查：findById 後比對 merchant_id，不符合就視同不存在（404，不回 403）——
 * 不洩漏「資源存在但非本人所有」。
 */
async function findOwnedService(
  id: string,
  merchantId: string,
): Promise<Tables<"rate_card_base"> | null> {
  const service = await servicesRepository.findById(id);
  if (service === null || service.merchant_id !== merchantId) {
    return null;
  }
  return service;
}

/** PATCH /api/dashboard/services/{id} — 只能改 base_price/includes/unit。 */
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
  const idParsed = serviceIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("服務項目 id 格式不正確", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = updateServiceBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const owned = await findOwnedService(idParsed.data, auth.merchantId);
    if (owned === null) {
      return apiFail("找不到指定的服務項目", 404);
    }

    const updated = await servicesRepository.update(idParsed.data, parsed.data);
    return apiOk({ item: updated });
  } catch (error) {
    console.error("[PATCH /api/dashboard/services/:id] 更新失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}

/** DELETE /api/dashboard/services/{id} — 軟刪除（is_active=false），非真實刪除。 */
export async function DELETE(
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
  const idParsed = serviceIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("服務項目 id 格式不正確", 400);
  }

  try {
    const owned = await findOwnedService(idParsed.data, auth.merchantId);
    if (owned === null) {
      return apiFail("找不到指定的服務項目", 404);
    }

    const updated = await servicesRepository.update(idParsed.data, {
      is_active: false,
    });
    return apiOk({ item: updated });
  } catch (error) {
    console.error("[DELETE /api/dashboard/services/:id] 刪除失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
