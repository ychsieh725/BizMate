import { z } from "zod";
import { QUOTE_STATUSES } from "@/shared/constants/quoteStatus.ts";

/** 報價 id 路徑參數：必須是合法 UUID（同 serviceIdSchema 慣例）。 */
export const quoteIdSchema = z.string().uuid();

/**
 * GET /api/dashboard/quotes 查詢參數：status 選填（值域為 quote_status enum），
 * q 選填（自由文字搜尋報價編號/客戶 email/狀態中文標籤）。
 */
export const listQuotesQuerySchema = z.object({
  status: z.enum(QUOTE_STATUSES).optional(),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;
