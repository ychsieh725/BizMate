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

/** 把 zod 錯誤壓成單行、面向使用者的訊息。 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}：${issue.message}` : issue.message;
    })
    .join("；");
}
