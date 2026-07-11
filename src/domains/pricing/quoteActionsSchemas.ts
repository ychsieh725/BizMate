import { z } from "zod";
import type { Tables } from "@/lib/supabase/database.types.ts";

/** quotes.final_amount 的欄位型別是 NUMERIC(10,2)——超過此值會在 DB 端溢位。 */
const MAX_FINAL_AMOUNT = 99_999_999.99;

/**
 * PATCH /api/dashboard/quotes/{id} 主體：只開放調整最終金額。
 * 上界在此擋下，而非讓 Postgres 溢位——溢位會被包成 RepositoryError 回 500，
 * 但這是使用者的輸入錯誤，該回 400。
 */
export const adjustAmountBodySchema = z.object({
  final_amount: z
    .number()
    .positive("金額須為正數")
    .max(MAX_FINAL_AMOUNT, "金額超出可接受範圍"),
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
