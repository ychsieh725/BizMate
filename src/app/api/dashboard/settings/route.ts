import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { updateSettingsBodySchema } from "@/domains/merchant/settingsSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";
import { isUniqueViolation } from "@/lib/supabase/errors.ts";

type SettingsView = { display_name: string; public_slug: string };

function toView(merchant: { display_name: string; public_slug: string }): SettingsView {
  return { display_name: merchant.display_name, public_slug: merchant.public_slug };
}

/** GET /api/dashboard/settings — 目前商家的 profile/slug。 */
export async function GET(): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  try {
    const merchant = await merchantsRepository.findById(auth.merchantId);
    if (merchant === null) {
      // requireMerchant 已確認 merchant 存在，這裡查無代表競態或資料不一致，
      // 不是使用者可修復的錯誤，回系統忙碌即可。
      console.error(
        `[GET /api/dashboard/settings] merchant ${auth.merchantId} 應存在但查無`,
      );
      return apiFail("系統忙碌，請稍後再試", 500);
    }
    return apiOk(toView(merchant));
  } catch (error) {
    console.error("[GET /api/dashboard/settings] 查詢失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}

/** PATCH /api/dashboard/settings — 改 display_name 和/或 public_slug。 */
export async function PATCH(request: Request): Promise<Response> {
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

  const parsed = updateSettingsBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const updated = await merchantsRepository.update(auth.merchantId, parsed.data);
    return apiOk(toView(updated));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiFail("此代號已被使用，請換一個", 409);
    }
    console.error("[PATCH /api/dashboard/settings] 更新失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
