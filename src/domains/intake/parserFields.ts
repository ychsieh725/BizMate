import { z } from "zod";
import type { CaseCategory } from "@/shared/types/domain.types";
import {
  LICENSE_SCOPE_DOMAIN,
  COLORING_COMPLEXITY_DOMAIN,
  BOOLEAN_DOMAIN,
} from "@/shared/constants/fieldDomains.ts";

/**
 * Intake Parser 依案件類型切換的必要欄位定義（PRD 附錄 A.1–A.4）。
 *
 * 這是「Parser 要抽哪些欄位」與「缺哪個欄位」的單一事實來源，同時餵給
 * Gemini structured output（強制回傳形狀）與程式端的缺漏判斷。
 */

/** 跨案件類型共用的必要欄位（附錄 A.1：授權、交期）。 */
export const COMMON_REQUIRED_FIELDS = [
  "license_scope", // 用途/授權範圍：個人/商業/獨家買斷/有限期限
  "deadline_days", // 交期天數（判斷是否急件）
] as const;

/** 各案件類型專屬的必要欄位（附錄 A.2–A.4）。 */
export const CATEGORY_SPECIFIC_FIELDS: Record<
  CaseCategory,
  readonly string[]
> = {
  graphic_design: ["subtype", "quantity", "includes_pitch_rounds"],
  illustration: ["subtype", "quantity", "coloring_complexity"],
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
 * 值域固定、與商家無關的欄位（WBS 6.8）。
 * subtype 不在此表——它的值域是 per-merchant 的 rate card，由呼叫端傳入。
 */
const STATIC_FIELD_DOMAINS: Record<string, readonly string[]> = {
  license_scope: LICENSE_SCOPE_DOMAIN,
  coloring_complexity: COLORING_COMPLEXITY_DOMAIN,
};

/**
 * `includes_` 開頭一律視為布林欄位。用前綴規則而非逐一列舉，是為了讓日後新增
 * 同類欄位自動獲得值域約束——漏掉值域會靜默退回自由字串，是不易察覺的退步。
 */
const BOOLEAN_FIELD_PREFIX = "includes_";

/** 取某欄位的合法值域；無固定值域回 null（表示自由字串）。 */
function domainFor(
  fieldName: string,
  allowedSubtypes: readonly string[],
): readonly string[] | null {
  // 新商家尚無 active 服務項目時清單為空。空 enum 會讓模型無值可選而必定失敗，
  // 故降級為自由字串（此時 rate card 本就查不到，會照既有路徑走 outOfScope）。
  if (fieldName === "subtype") {
    return allowedSubtypes.length > 0 ? allowedSubtypes : null;
  }
  if (fieldName.startsWith(BOOLEAN_FIELD_PREFIX)) return BOOLEAN_DOMAIN;
  return STATIC_FIELD_DOMAINS[fieldName] ?? null;
}

/**
 * 單一欄位的抽取結果 schema，值域已知時以 enum 限縮。
 * 無論是否受限，value 一律 nullable——「原文未提及」必須是合法輸出，否則模型
 * 會被迫從清單硬選一個，把誠實的缺漏變成自信的錯配。
 */
function fieldSchemaFor(
  fieldName: string,
  allowedSubtypes: readonly string[],
): z.ZodType<FieldExtraction> {
  const domain = domainFor(fieldName, allowedSubtypes);
  const valueSchema =
    domain == null
      ? z.string().nullable()
      : z.enum([...domain] as [string, ...string[]]).nullable();

  return z.object({
    value: valueSchema,
    confidence: z.number().min(0).max(1),
    source_span: z.string().nullable(),
  }) as z.ZodType<FieldExtraction>;
}

/**
 * 依 category 動態組出 Parser 的回傳 schema：只要求 LLM 輸出各必要欄位的抽取結果。
 * missing_required_fields **不交給 LLM**，由程式端依 CONFIDENCE_THRESHOLD 算（deterministic、可測）。
 *
 * allowedSubtypes 為該商家 rate card 中 active 的子類型清單（WBS 6.8）：值域直接
 * 編進送給 Gemini 的 JSON Schema，讓模型在生成時就只能選表內的值，而非事後用
 * 模糊比對猜測「公司LOGO」是不是「LOGO設計」。
 */
export function buildParseResponseSchema(
  category: CaseCategory,
  allowedSubtypes: readonly string[],
): z.ZodType<{ fields: Record<string, FieldExtraction> }> {
  const shape: Record<string, z.ZodType<FieldExtraction>> = {};
  for (const field of requiredFieldsFor(category)) {
    shape[field] = fieldSchemaFor(field, allowedSubtypes);
  }
  return z.object({ fields: z.object(shape) }) as z.ZodType<{
    fields: Record<string, FieldExtraction>;
  }>;
}
