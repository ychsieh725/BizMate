import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH } from "./onboardingSchemas.ts";

/** 對齊 migration 0001 的 public_slug CHECK：^[a-z0-9][a-z0-9-]{2,31}$（3-32 字元）。 */
const PUBLIC_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

/**
 * PATCH /api/dashboard/settings 主體：display_name/public_slug 皆為選填，
 * 但至少要帶一欄（.refine 擋空物件）——沒有要改任何東西的請求沒有意義。
 */
export const updateSettingsBodySchema = z
  .object({
    display_name: z
      .string()
      .min(1, "商家名稱不可為空")
      .max(
        DISPLAY_NAME_MAX_LENGTH,
        `商家名稱長度不可超過 ${DISPLAY_NAME_MAX_LENGTH} 字`,
      )
      .optional(),
    public_slug: z
      .string()
      .regex(
        PUBLIC_SLUG_PATTERN,
        "代號只能用小寫英數字與連字號，需 3-32 字元且以英數字開頭",
      )
      .optional(),
  })
  .refine((data) => data.display_name !== undefined || data.public_slug !== undefined, {
    message: "至少需要提供 display_name 或 public_slug 其中一項",
  });
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;
