import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildParseResponseSchema, requiredFieldsFor } from "./parserFields.ts";
import {
  LICENSE_SCOPE_DOMAIN,
  COLORING_COMPLEXITY_DOMAIN,
  BOOLEAN_DOMAIN,
} from "@/shared/constants/fieldDomains.ts";

/**
 * Parser 回傳 schema 的值域約束（WBS 6.8）。
 *
 * 這份 schema 會被 z.toJSONSchema 轉成 Gemini 的 responseJsonSchema，是「模型
 * 只能回什麼值」的唯一約束點。測試直接斷言轉換後的 JSON Schema——那才是真正
 * 送出去的東西，斷言 zod 物件本身無法證明 enum 有傳到模型。
 */

const SUBTYPES = ["LOGO設計", "海報文宣", "品牌識別CI-VI"];

/** 取出 JSON Schema 中某欄位 value 的定義，供斷言 enum 是否生效。 */
function valueSchemaOf(
  category: Parameters<typeof requiredFieldsFor>[0],
  fieldName: string,
  allowedSubtypes: readonly string[] = SUBTYPES,
): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(
    buildParseResponseSchema(category, allowedSubtypes),
  ) as unknown as {
    properties: {
      fields: {
        properties: Record<string, { properties: { value: Record<string, unknown> } }>;
      };
    };
  };
  return jsonSchema.properties.fields.properties[fieldName].properties.value;
}

/** JSON Schema 的 nullable 值可能表述為 anyOf/oneOf，統一挖出 enum 陣列。 */
function extractEnum(valueSchema: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(valueSchema.enum)) return valueSchema.enum;
  for (const key of ["anyOf", "oneOf"]) {
    const branches = valueSchema[key];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      if (branch != null && Array.isArray((branch as { enum?: unknown[] }).enum)) {
        return (branch as { enum: unknown[] }).enum;
      }
    }
  }
  return null;
}

describe("buildParseResponseSchema — subtype 動態值域", () => {
  it("傳入商家的 subtype 清單時，schema 以 enum 限縮", () => {
    const enumValues = extractEnum(valueSchemaOf("graphic_design", "subtype"));
    expect(enumValues).not.toBeNull();
    expect(new Set(enumValues)).toEqual(new Set(SUBTYPES));
  });

  it("subtype 清單為空時退回自由字串，不產生空 enum", () => {
    // 新商家尚未有任何 active 服務項目時，空 enum 會讓模型無值可選而必定失敗，
    // 故必須降級為自由字串（此時 rate card 也查不到，本就會走 outOfScope）。
    const enumValues = extractEnum(valueSchemaOf("graphic_design", "subtype", []));
    expect(enumValues).toBeNull();
  });

  it("值域外的 subtype 會被 schema 拒絕", () => {
    const schema = buildParseResponseSchema("graphic_design", SUBTYPES);
    const build = (subtypeValue: string) => ({
      fields: Object.fromEntries(
        requiredFieldsFor("graphic_design").map((name) => [
          name,
          {
            value: name === "subtype" ? subtypeValue : null,
            confidence: 0.9,
            source_span: null,
          },
        ]),
      ),
    });

    expect(schema.safeParse(build("LOGO設計")).success).toBe(true);
    expect(schema.safeParse(build("公司LOGO")).success).toBe(false);
  });
});

describe("buildParseResponseSchema — 靜態值域", () => {
  it("license_scope 限縮為三種授權範圍", () => {
    const enumValues = extractEnum(valueSchemaOf("graphic_design", "license_scope"));
    expect(new Set(enumValues)).toEqual(new Set(LICENSE_SCOPE_DOMAIN));
  });

  it("coloring_complexity 限縮為三種上色程度（插畫專屬）", () => {
    const enumValues = extractEnum(
      valueSchemaOf("illustration", "coloring_complexity"),
    );
    expect(new Set(enumValues)).toEqual(new Set(COLORING_COMPLEXITY_DOMAIN));
  });

  it("includes_* 布林欄位限縮為是/否", () => {
    for (const [category, field] of [
      ["graphic_design", "includes_pitch_rounds"],
      ["web_design", "includes_rwd"],
      ["web_design", "includes_cms"],
    ] as const) {
      const enumValues = extractEnum(valueSchemaOf(category, field));
      expect(new Set(enumValues), `${field} 未限縮為布林值域`).toEqual(
        new Set(BOOLEAN_DOMAIN),
      );
    }
  });

  it("無固定值域的欄位維持自由字串", () => {
    for (const [category, field] of [
      ["graphic_design", "quantity"],
      ["graphic_design", "deadline_days"],
      ["web_design", "page_count"],
      ["web_design", "feature_modules"],
    ] as const) {
      expect(
        extractEnum(valueSchemaOf(category, field)),
        `${field} 不應有 enum 約束`,
      ).toBeNull();
    }
  });
});

describe("buildParseResponseSchema — null 仍為合法輸出", () => {
  it("受 enum 約束的欄位仍可回 null（原文未提及時的誠實答案）", () => {
    const schema = buildParseResponseSchema("illustration", SUBTYPES);
    const allNull = {
      fields: Object.fromEntries(
        requiredFieldsFor("illustration").map((name) => [
          name,
          { value: null, confidence: 0, source_span: null },
        ]),
      ),
    };
    expect(schema.safeParse(allNull).success).toBe(true);
  });
});
