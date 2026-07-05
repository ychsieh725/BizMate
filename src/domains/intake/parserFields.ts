import { z } from "zod";
import type { CaseCategory } from "@/shared/types/domain.types";

/**
 * Intake Parser 依案件類型切換的必要欄位定義（PRD 附錄 A.1–A.4）。
 *
 * 這是「Parser 要抽哪些欄位」與「缺哪個欄位」的單一事實來源，同時餵給
 * Gemini structured output（強制回傳形狀）與程式端的缺漏判斷。
 */

/** 跨案件類型共用的必要欄位（附錄 A.1：授權、交期、修改次數）。 */
export const COMMON_REQUIRED_FIELDS = [
  "license_scope", // 用途/授權範圍：個人/商業/獨家買斷/有限期限
  "deadline_days", // 交期天數（判斷是否急件）
  "revision_count", // 內含修改次數
] as const;

/** 各案件類型專屬的必要欄位（附錄 A.2–A.4）。 */
export const CATEGORY_SPECIFIC_FIELDS: Record<
  CaseCategory,
  readonly string[]
> = {
  graphic_design: ["subtype", "quantity", "includes_pitch_rounds"],
  illustration: [
    "subtype",
    "quantity",
    "coloring_complexity",
    "resolution_requirement",
  ],
  web_design: [
    "subtype",
    "page_count",
    "feature_modules",
    "includes_rwd",
    "includes_cms",
  ],
};

/** 某案件類型的完整必要欄位清單（專屬 + 共用）。 */
export function requiredFieldsFor(category: CaseCategory): string[] {
  return [...CATEGORY_SPECIFIC_FIELDS[category], ...COMMON_REQUIRED_FIELDS];
}

/**
 * confidence 門檻：低於此值視為「抽取不可靠」，等同缺漏、觸發反問。
 * 為假設初始值，待 P2 golden set eval 校準（PRD §14.2 #1）。
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/**
 * 單一欄位的抽取結果。value 統一以字串（或 null）承載——抽取階段只取原文值，
 * 型別轉換（數字/布林/陣列）留給下游 pricing，避免抽取 schema 因欄位型別爆炸。
 */
export const fieldExtractionSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  source_span: z.string().nullable(),
});

export type FieldExtraction = z.infer<typeof fieldExtractionSchema>;

/**
 * 依 category 動態組出 Parser 的回傳 schema：只要求 LLM 輸出各必要欄位的抽取結果。
 * missing_required_fields **不交給 LLM**，由程式端依 CONFIDENCE_THRESHOLD 算（deterministic、可測）。
 */
export function buildParseResponseSchema(
  category: CaseCategory,
): z.ZodType<{ fields: Record<string, FieldExtraction> }> {
  const shape: Record<string, typeof fieldExtractionSchema> = {};
  for (const field of requiredFieldsFor(category)) {
    shape[field] = fieldExtractionSchema;
  }
  return z.object({ fields: z.object(shape) }) as z.ZodType<{
    fields: Record<string, FieldExtraction>;
  }>;
}
