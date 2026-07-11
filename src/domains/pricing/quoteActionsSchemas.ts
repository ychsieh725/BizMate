import { z } from "zod";
import type { Tables } from "@/lib/supabase/database.types.ts";

/** PATCH /api/dashboard/quotes/{id} 主體：只開放調整最終金額。 */
export const adjustAmountBodySchema = z.object({
  final_amount: z.number().positive("金額須為正數"),
});
export type AdjustAmountBody = z.infer<typeof adjustAmountBodySchema>;

/**
 * 後台動作的結果型別。
 * not_found → route 轉 404（不存在或非本商家所有，不洩漏存在性）
 * conflict  → route 轉 409（報價已確認/已寄出，或併發下被搶先）
 */
export type QuoteActionResult =
  | { readonly ok: true; readonly quote: Tables<"quotes"> }
  | { readonly ok: false; readonly reason: "not_found" | "conflict" };
