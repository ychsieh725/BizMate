import { z } from "zod";

export const DISPLAY_NAME_MAX_LENGTH = 100;

/** POST /api/dashboard/onboarding 主體：僅商家名稱，slug 由系統自動產生。 */
export const onboardingBodySchema = z.object({
  display_name: z
    .string()
    .min(1, "商家名稱不可為空")
    .max(
      DISPLAY_NAME_MAX_LENGTH,
      `商家名稱長度不可超過 ${DISPLAY_NAME_MAX_LENGTH} 字`,
    ),
});
