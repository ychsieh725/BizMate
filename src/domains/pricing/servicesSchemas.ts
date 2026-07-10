import { z } from "zod";
import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORIES } from "@/shared/constants/categories.ts";

const CATEGORY_VALUES = CASE_CATEGORIES as readonly [
  CaseCategory,
  ...CaseCategory[],
];

/** POST /api/dashboard/services 主體：新增一筆商家自有的基礎費率列。 */
export const createServiceBodySchema = z.object({
  category: z.enum(CATEGORY_VALUES),
  subtype: z.string().min(1, "子類型不可為空"),
  unit: z.string().min(1, "單位不可為空"),
  base_price: z.number().positive("基礎價格須為正數"),
  includes: z.string().nullable().optional(),
});
export type CreateServiceBody = z.infer<typeof createServiceBodySchema>;

/**
 * PATCH /api/dashboard/services/{id} 主體：只開放 base_price/includes/unit。
 * category/subtype 不可改（UNIQUE (merchant_id, category, subtype) 且被
 * rateCardRepository.findBase 直接引用查詢，改了會影響既有報價可追溯性）。
 */
export const updateServiceBodySchema = z.object({
  base_price: z.number().positive("基礎價格須為正數").optional(),
  includes: z.string().nullable().optional(),
  unit: z.string().min(1, "單位不可為空").optional(),
});
export type UpdateServiceBody = z.infer<typeof updateServiceBodySchema>;

/** 服務項目 id 路徑參數：必須是合法 UUID（DB 主鍵格式）。 */
export const serviceIdSchema = z.string().guid();
