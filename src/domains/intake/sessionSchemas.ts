import { z } from "zod";
import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORIES } from "@/shared/constants/categories.ts";

/**
 * Wizard API 的請求邊界驗證（coding-style「在系統邊界驗證」）。
 * category 清單從單一事實來源 CASE_CATEGORIES 衍生，不重複列舉。
 */
export const createSessionBodySchema = z.object({
  category: z.enum(
    CASE_CATEGORIES as readonly [CaseCategory, ...CaseCategory[]],
  ),
});

/** session id 路徑參數：必須是合法 UUID（DB 主鍵格式）。 */
export const sessionIdSchema = z.string().uuid();

/**
 * raw_text 長度上限（NFR-7）：口語需求描述綽綽有餘，同時擋下惡意超大 payload
 * 灌爆 Gemini token 與 DB。
 */
export const RAW_TEXT_MAX_LENGTH = 2000;

/** email 長度上限：RFC 5321 的位址上限。 */
export const CONTACT_EMAIL_MAX_LENGTH = 254;

/** POST /describe 主體：口語描述 + 聯絡 email（FR-CW-2 AC：email 格式驗證）。 */
export const describeBodySchema = z.object({
  raw_text: z
    .string()
    .min(1, "描述不可為空")
    .max(RAW_TEXT_MAX_LENGTH, `描述長度不可超過 ${RAW_TEXT_MAX_LENGTH} 字`),
  contact_email: z
    .string()
    .max(CONTACT_EMAIL_MAX_LENGTH, "email 長度過長")
    .email("email 格式不正確"),
});

/** 把 zod 錯誤壓成單行、面向使用者的訊息。 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}：${issue.message}` : issue.message;
    })
    .join("；");
}
