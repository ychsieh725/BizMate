/**
 * 區間加成係數的確定性求值（WBS 6.1 階段一）。
 *
 * ## 這個檔案要守住的原則
 *
 * **能確定性判斷的就不該交給 LLM。** 這與不變式 I-2（缺漏判定不經 LLM）
 * 是同一條原則的延伸。6 個區間係數裡有 3 個的觸發與取值都能從既有欄位算出，
 * 交給模型只是多花錢並引入不確定性。
 *
 * 另外 3 個誠實地不處理：
 * - 印刷檔輸出、高解析度輸出：沒有對應的抽取欄位可判斷
 * - 品牌規範完整度：觸發條件是「需完整VI系統而非僅LOGO」，但 subtype 若已是
 *   品牌識別CI-VI，base_price 的 includes 就寫著「VI手冊PDF」，用 subtype
 *   觸發會重複計價
 *
 * ## 取區間下限的理由
 *
 * 確定性求值判斷得出「有沒有觸發」，判斷不出「程度」。此時取下限而非上限或
 * 中點，沿用 parseQuantity「非正整數一律回退 1（保守，不放大金額）」的既有
 * 慣例：寧可少報，商家可以往上調，而 6.4 的調價指標會把「系統性低估」量出來。
 */
import { describe, expect, it } from "vitest";

import type { ExtractedValues } from "./pricingTypes.ts";
import { evaluateModifier } from "./modifierEvaluators.ts";

function modifier(
  triggerCondition: string,
  rangeMin: number | null = 0.2,
  rangeMax: number | null = 0.5,
) {
  return {
    trigger_condition: triggerCondition,
    range_min: rangeMin,
    range_max: rangeMax,
  };
}

function fields(values: Record<string, string | null>): ExtractedValues {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, { value }]),
  );
}

describe("授權範圍（既有行為，不得改變）", () => {
  it("相符時觸發，倍率取下限（固定倍率的 min === max）", () => {
    const result = evaluateModifier(
      modifier("授權範圍=商業使用", 0.3, 0.3),
      fields({ license_scope: "商業使用" }),
    );

    expect(result).toEqual({ ratio: 0.3, applications: 1 });
  });

  it("不相符時不觸發", () => {
    expect(
      evaluateModifier(
        modifier("授權範圍=獨家買斷", 1, 1),
        fields({ license_scope: "商業使用" }),
      ),
    ).toBeNull();
  });

  it("欄位缺漏時不觸發", () => {
    expect(
      evaluateModifier(modifier("授權範圍=商業使用", 0.3, 0.3), fields({})),
    ).toBeNull();
  });
});

describe("急件加成", () => {
  const URGENT = modifier("交期<=急件門檻(3天)", 0.2, 0.5);

  it.each([1, 3])("交期 %i 天觸發，取區間下限", (days) => {
    expect(evaluateModifier(URGENT, fields({ deadline_days: String(days) }))).toEqual({
      ratio: 0.2,
      applications: 1,
    });
  });

  it("交期 4 天不觸發（門檻為 3 天，閉區間）", () => {
    expect(evaluateModifier(URGENT, fields({ deadline_days: "4" }))).toBeNull();
  });

  it.each([
    ["缺漏", null],
    ["非數字", "很急"],
    ["零", "0"],
    ["負數", "-1"],
  ])("交期為%s時不觸發 —— 判斷不出來就不加價", (_label, value) => {
    expect(evaluateModifier(URGENT, fields({ deadline_days: value }))).toBeNull();
  });
});

describe("上色複雜度加成", () => {
  const COLORING = modifier("精緻上色vs簡易上色/線稿", 0.2, 0.6);

  it("精緻上色觸發", () => {
    expect(
      evaluateModifier(COLORING, fields({ coloring_complexity: "精緻上色" })),
    ).toEqual({ ratio: 0.2, applications: 1 });
  });

  it.each(["簡易上色", "線稿"])(
    "%s 不觸發 —— base_price 的 includes 已涵蓋一般完稿",
    (value) => {
      expect(
        evaluateModifier(COLORING, fields({ coloring_complexity: value })),
      ).toBeNull();
    },
  );

  it("值域外的說法不觸發，而非勉強歸類", () => {
    expect(
      evaluateModifier(COLORING, fields({ coloring_complexity: "超級精緻" })),
    ).toBeNull();
  });
});

describe("功能模組複雜度", () => {
  const MODULES = modifier("每加一個模組(會員/金流/多語系)", 0.15, 0.4);

  it.each([
    ["頓號分隔", "會員系統、金流、多語系", 3],
    ["逗號分隔", "會員系統,金流", 2],
    ["單一模組", "金流", 1],
  ])("%s：套用次數等於模組數", (_label, value, expected) => {
    expect(evaluateModifier(MODULES, fields({ feature_modules: value }))).toEqual({
      ratio: 0.15,
      applications: expected,
    });
  });

  it("明確表示不需要（無）時不觸發", () => {
    expect(evaluateModifier(MODULES, fields({ feature_modules: "無" }))).toBeNull();
  });

  it("缺漏時不觸發", () => {
    expect(evaluateModifier(MODULES, fields({ feature_modules: null }))).toBeNull();
  });

  it("分隔符之間的空白不會產生空模組", () => {
    expect(
      evaluateModifier(MODULES, fields({ feature_modules: "會員系統 、 金流 ," })),
    ).toEqual({ ratio: 0.15, applications: 2 });
  });
});

describe("無法確定性判斷的係數", () => {
  it.each([
    ["印刷檔輸出", "需CMYK/出血/向量印刷檔"],
    ["高解析度輸出", "需高解析度原檔/印刷輸出"],
    ["品牌規範完整度", "需完整VI系統文件而非僅LOGO"],
  ])("%s 不觸發 —— 留給日後的推理層，不猜", (_label, condition) => {
    expect(
      evaluateModifier(
        modifier(condition),
        fields({ subtype: "品牌識別CI-VI", license_scope: "商業使用" }),
      ),
    ).toBeNull();
  });

  it("未知的觸發條件不觸發，而非拋錯", () => {
    expect(
      evaluateModifier(modifier("某種未來才會加的條件"), fields({})),
    ).toBeNull();
  });
});

describe("區間驗證整合", () => {
  it("區間未定義時不觸發 —— 沒有邊界就不套用", () => {
    expect(
      evaluateModifier(
        modifier("交期<=急件門檻(3天)", null, 0.5),
        fields({ deadline_days: "1" }),
      ),
    ).toBeNull();
  });

  it("區間反轉時不觸發", () => {
    expect(
      evaluateModifier(
        modifier("交期<=急件門檻(3天)", 0.5, 0.2),
        fields({ deadline_days: "1" }),
      ),
    ).toBeNull();
  });
});
