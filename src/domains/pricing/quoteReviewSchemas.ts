import { z } from "zod";
import { QUOTE_STATUSES } from "@/shared/constants/quoteStatus.ts";

/** 報價 id 路徑參數：必須是合法 UUID（同 serviceIdSchema 慣例）。 */
export const quoteIdSchema = z.string().uuid();

/** GET /api/dashboard/quotes 查詢參數：status 選填，值域為 quote_status enum。 */
export const listQuotesQuerySchema = z.object({
  status: z.enum(QUOTE_STATUSES).optional(),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;
