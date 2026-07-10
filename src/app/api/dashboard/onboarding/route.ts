import { apiOk, apiFail } from "@/lib/api/response.ts";
import { createClient } from "@/lib/supabase/serverClient.ts";
import { onboardMerchant } from "@/domains/merchant/onboardMerchant.ts";
import { onboardingBodySchema } from "@/domains/merchant/onboardingSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";

/**
 * POST /api/dashboard/onboarding — 使用者登入後建立自己的 merchant（冪等，5.3）。
 * 此階段尚無 requireMerchant/RLS policy（5.4），故直接用 session 驗證登入。
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null || user.email == null) {
    return apiFail("請先登入", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = onboardingBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const { merchant, created } = await onboardMerchant(
      user.id,
      user.email,
      parsed.data.display_name,
    );
    return apiOk({ merchant }, created ? 201 : 200);
  } catch (error) {
    console.error(
      "[POST /api/dashboard/onboarding] onboardMerchant 失敗：",
      error,
    );
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
