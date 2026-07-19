import { describe, it, expect } from "vitest";
import { compareFields, toExtractedValues } from "./comparison.ts";

describe("compareFields", () => {
  it("兩側正規化後相等即為抽對（措辭差異不算錯）", () => {
    const result = compareFields(
      { license_scope: "商業使用" },
      { license_scope: { value: "商業用途" } },
    );
    expect(result[0].correct).toBe(true);
  });

  it("subtype 不做正規化，差一個字即為抽錯（下游精確查表）", () => {
    const result = compareFields(
      { subtype: "LOGO設計" },
      { subtype: { value: "公司LOGO" } },
    );
    expect(result[0]).toEqual({
      name: "subtype",
      expected: "LOGO設計",
      actual: "公司LOGO",
      correct: false,
    });
  });

  it("模型未回傳的欄位以 null 參與比對", () => {
    const result = compareFields({ deadline_days: "14" }, {});
    expect(result[0].actual).toBeNull();
    expect(result[0].correct).toBe(false);
  });

  it("標註為 null 且模型也未抽出 → 抽對（不杜撰是正確行為）", () => {
    const result = compareFields(
      { deadline_days: null },
      { deadline_days: { value: null } },
    );
    expect(result[0].correct).toBe(true);
  });

  it("以標註的欄位集合為準，逐欄回傳", () => {
    const result = compareFields(
      { subtype: "LOGO設計", quantity: "1" },
      { subtype: { value: "LOGO設計" } },
    );
    expect(result.map((item) => item.name)).toEqual(["subtype", "quantity"]);
  });
});

describe("toExtractedValues", () => {
  it("轉成計價輸入形狀，保留未正規化的原值", () => {
    // computeBasePricing 內部自有正規化，此處先動手會量不到計價的真實行為
    expect(toExtractedValues({ license_scope: "商業使用", quantity: "3" })).toEqual({
      license_scope: { value: "商業使用" },
      quantity: { value: "3" },
    });
  });

  it("null 值原樣帶過（代表該欄缺漏）", () => {
    expect(toExtractedValues({ subtype: null })).toEqual({
      subtype: { value: null },
    });
  });
});
