import { describe, it, expect } from "vitest";
import { GOLDEN_CASES, casesByCategory, caseById } from "./goldenSet.ts";
import { goldenCaseSchema } from "./goldenSet.types.ts";
import { requiredFieldsFor } from "@/domains/intake/parserFields.ts";
import { CASE_CATEGORIES } from "@/shared/constants/categories.ts";
import { BASE_ROWS } from "../../../scripts/rate-card-data.ts";

/**
 * Golden Set 的資料完整性守門（WBS 7.1）。
 *
 * 這份資料是 Eval Runner（7.2）與 CI 品質閘門（8.5）的量測基準——基準本身若有
 * 標註錯誤，量出來的所有指標都是垃圾。故用測試把「標註不可能自相矛盾」變成
 * 編譯/測試期就擋下的不變式，而非仰賴人工覆核。
 */

const EXPECTED_TOTAL = 36;
const EXPECTED_PER_CATEGORY = 12;

/** id 前綴 ↔ category 的對應，讓 id 一眼看得出屬於哪類。 */
const ID_PREFIX: Record<string, string> = {
  graphic_design: "graphic",
  illustration: "illu",
  web_design: "web",
};

describe("Golden Set — 規模與結構", () => {
  it(`共 ${EXPECTED_TOTAL} 則案例（WBS 7.1 訂 30-50 則）`, () => {
    expect(GOLDEN_CASES).toHaveLength(EXPECTED_TOTAL);
  });

  it("每個案件類型各 12 則，分佈平均", () => {
    for (const category of CASE_CATEGORIES) {
      expect(casesByCategory(category)).toHaveLength(EXPECTED_PER_CATEGORY);
    }
  });

  it("每則案例都符合 goldenCaseSchema", () => {
    for (const goldenCase of GOLDEN_CASES) {
      const result = goldenCaseSchema.safeParse(goldenCase);
      expect(result.success, `案例 ${goldenCase.id} 不符 schema`).toBe(true);
    }
  });
});

describe("Golden Set — 識別碼", () => {
  it("id 全域唯一（重複會讓指標按案例追蹤失效）", () => {
    const ids = GOLDEN_CASES.map((goldenCase) => goldenCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("id 前綴對應其 category", () => {
    for (const goldenCase of GOLDEN_CASES) {
      expect(
        goldenCase.id.startsWith(`${ID_PREFIX[goldenCase.category]}-`),
        `案例 ${goldenCase.id} 前綴與 category ${goldenCase.category} 不符`,
      ).toBe(true);
    }
  });

  it("caseById 找得到既有案例、找不到的回 undefined", () => {
    const first = GOLDEN_CASES[0];
    expect(caseById(first.id)).toEqual(first);
    expect(caseById("does-not-exist")).toBeUndefined();
  });

  it("rawText 不重複（重複案例會讓指標權重失衡）", () => {
    const texts = GOLDEN_CASES.map((goldenCase) => goldenCase.rawText);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("Golden Set — 標註自洽性（核心不變式）", () => {
  it("expected.fields 的鍵恰好等於該 category 的必要欄位", () => {
    for (const goldenCase of GOLDEN_CASES) {
      const actual = new Set(Object.keys(goldenCase.expected.fields));
      const required = new Set(requiredFieldsFor(goldenCase.category));
      expect(actual, `案例 ${goldenCase.id} 的欄位集合與必要欄位不符`).toEqual(
        required,
      );
    }
  });

  it("missingRequiredFields 恰好等於 value 為 null 的欄位", () => {
    for (const goldenCase of GOLDEN_CASES) {
      const nullFields = Object.entries(goldenCase.expected.fields)
        .filter(([, value]) => value === null)
        .map(([name]) => name);
      expect(
        new Set(goldenCase.expected.missingRequiredFields),
        `案例 ${goldenCase.id} 的缺漏清單與 null 欄位不一致`,
      ).toEqual(new Set(nullFields));
    }
  });

  it("有值的欄位不得為空字串或純空白（等同缺漏卻沒標成 null）", () => {
    for (const goldenCase of GOLDEN_CASES) {
      for (const [name, value] of Object.entries(goldenCase.expected.fields)) {
        if (value === null) continue;
        expect(
          value.trim().length,
          `案例 ${goldenCase.id} 的欄位 ${name} 是空白值`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("Golden Set — 與 rate card 對齊", () => {
  it("標註的 subtype 必須是該 category 在 rate card 中真實存在的子類型", () => {
    for (const goldenCase of GOLDEN_CASES) {
      const subtype = goldenCase.expected.fields.subtype;
      if (subtype == null) continue;

      const validSubtypes = BASE_ROWS.filter(
        (row) => row.category === goldenCase.category,
      ).map((row) => row.subtype);

      expect(
        validSubtypes,
        `案例 ${goldenCase.id} 的 subtype「${subtype}」不在 rate card 中`,
      ).toContain(subtype);
    }
  });
});

describe("Golden Set — 案例形態覆蓋", () => {
  it("每個 category 都有「完全無缺漏」的 happy path 案例", () => {
    for (const category of CASE_CATEGORIES) {
      const complete = casesByCategory(category).filter(
        (goldenCase) => goldenCase.expected.missingRequiredFields.length === 0,
      );
      expect(
        complete.length,
        `${category} 缺少無缺漏案例`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("每個 category 都有「部分缺漏」的反問觸發案例", () => {
    for (const category of CASE_CATEGORIES) {
      const partial = casesByCategory(category).filter((goldenCase) => {
        const missing = goldenCase.expected.missingRequiredFields.length;
        const total = Object.keys(goldenCase.expected.fields).length;
        return missing > 0 && missing < total;
      });
      expect(
        partial.length,
        `${category} 缺少部分缺漏案例`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("每個 category 都有 prompt injection 嘗試案例（NFR-8 三層防禦的量測基準）", () => {
    for (const category of CASE_CATEGORIES) {
      const injection = casesByCategory(category).filter((goldenCase) =>
        goldenCase.notes.includes("injection"),
      );
      expect(
        injection.length,
        `${category} 缺少 prompt injection 案例`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
