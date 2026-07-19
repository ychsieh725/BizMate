import { describe, it, expect } from "vitest";
import { computeMetrics } from "./metrics.ts";
import type { CaseOutcome, FieldComparison } from "./evalTypes.ts";

/**
 * PRD §8.2 指標的計算（WBS 7.2）。
 *
 * 全部以假資料測試——指標邏輯是純函式，不該為了測它去跑 Gemini 或連資料庫。
 * 用手算得出的小數字驗證公式，比用真實資料「看起來合理」可靠得多。
 */

function field(
  name: string,
  expected: string | null,
  actual: string | null,
): FieldComparison {
  return { name, expected, actual, correct: expected === actual };
}

function outcome(overrides: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    id: "case-1",
    fields: [],
    predictedMissing: [],
    expectedMissing: [],
    expectedAmount: null,
    actualAmount: null,
    outOfScope: false,
    latencyMs: 100,
    costUsd: 0.0001,
    modelVersion: "gemini-3.1-flash-lite",
    ...overrides,
  };
}

describe("computeMetrics — 空輸入", () => {
  it("沒有案例時全部指標為 null，而非 0", () => {
    const metrics = computeMetrics([]);
    expect(metrics.fieldExtractionAccuracy).toBeNull();
    expect(metrics.hallucinationRate).toBeNull();
    expect(metrics.endToEndSuccessRate).toBeNull();
    expect(metrics.costPerCaseUsd).toBeNull();
  });
});

describe("computeMetrics — 欄位抽取準確率", () => {
  it("正確欄位數 / 總欄位數", () => {
    const metrics = computeMetrics([
      outcome({
        fields: [
          field("subtype", "LOGO設計", "LOGO設計"),
          field("quantity", "1", "1"),
          field("license_scope", "商業使用", null),
          field("deadline_days", "14", "7"),
        ],
      }),
    ]);
    expect(metrics.fieldExtractionAccuracy).toBeCloseTo(0.5);
  });

  it("正確判為 null 也算抽對（不杜撰是正確行為）", () => {
    const metrics = computeMetrics([
      outcome({ fields: [field("subtype", null, null)] }),
    ]);
    expect(metrics.fieldExtractionAccuracy).toBe(1);
  });
});

describe("computeMetrics — 欄位 F1", () => {
  it("全對時 F1 為 1", () => {
    const metrics = computeMetrics([
      outcome({
        fields: [field("subtype", "LOGO設計", "LOGO設計"), field("quantity", "1", "1")],
      }),
    ]);
    expect(metrics.fieldExtractionF1).toBe(1);
  });

  it("漏抽（該有值卻回 null）會拉低 recall 進而拉低 F1", () => {
    // TP=1, FP=0, FN=1 → precision=1, recall=0.5, F1=2*1*0.5/1.5≈0.667
    const metrics = computeMetrics([
      outcome({
        fields: [
          field("subtype", "LOGO設計", "LOGO設計"),
          field("quantity", "3", null),
        ],
      }),
    ]);
    expect(metrics.fieldExtractionF1).toBeCloseTo(2 / 3, 3);
  });

  it("抽錯值同時計入 FP 與 FN", () => {
    // TP=0, FP=1, FN=1 → precision=0, recall=0, F1=0
    const metrics = computeMetrics([
      outcome({ fields: [field("subtype", "LOGO設計", "公司LOGO")] }),
    ]);
    expect(metrics.fieldExtractionF1).toBe(0);
  });
});

describe("computeMetrics — 反問精準率／召回率", () => {
  it("該問的都問到且沒亂問 → 兩者皆為 1", () => {
    const metrics = computeMetrics([
      outcome({
        predictedMissing: ["deadline_days", "license_scope"],
        expectedMissing: ["deadline_days", "license_scope"],
      }),
    ]);
    expect(metrics.clarificationPrecision).toBe(1);
    expect(metrics.clarificationRecall).toBe(1);
  });

  it("問了不該問的 → precision 下降（客戶被問已回答的事）", () => {
    const metrics = computeMetrics([
      outcome({
        predictedMissing: ["deadline_days", "quantity"],
        expectedMissing: ["deadline_days"],
      }),
    ]);
    expect(metrics.clarificationPrecision).toBeCloseTo(0.5);
    expect(metrics.clarificationRecall).toBe(1);
  });

  it("該問沒問 → recall 下降（會拿缺漏資訊去報價）", () => {
    const metrics = computeMetrics([
      outcome({
        predictedMissing: ["deadline_days"],
        expectedMissing: ["deadline_days", "license_scope"],
      }),
    ]);
    expect(metrics.clarificationPrecision).toBe(1);
    expect(metrics.clarificationRecall).toBeCloseTo(0.5);
  });
});

describe("computeMetrics — 幻覺率", () => {
  it("原文未提及卻抽出值的比例（分母只算標註為 null 的欄位）", () => {
    const metrics = computeMetrics([
      outcome({
        fields: [
          field("subtype", null, "亂編的值"),
          field("quantity", null, null),
          field("license_scope", "商業使用", "商業使用"),
        ],
      }),
    ]);
    // 標註為 null 的有 2 欄，其中 1 欄被杜撰
    expect(metrics.hallucinationRate).toBeCloseTo(0.5);
  });

  it("沒有任何標註為 null 的欄位時回 null（無從評估）", () => {
    const metrics = computeMetrics([
      outcome({ fields: [field("subtype", "LOGO設計", "LOGO設計")] }),
    ]);
    expect(metrics.hallucinationRate).toBeNull();
  });
});

describe("computeMetrics — 報價偏差", () => {
  it("以標註欄位算出的金額為基準，計算抽取錯誤造成的偏差", () => {
    const metrics = computeMetrics([
      outcome({ id: "a", expectedAmount: 12000, actualAmount: 96000 }),
      outcome({ id: "b", expectedAmount: 10000, actualAmount: 10000 }),
    ]);
    // a 偏差 700%、b 偏差 0% → 平均 350%
    expect(metrics.quoteDeviationAvg).toBeCloseTo(3.5);
    expect(metrics.quoteDeviationMax).toBeCloseTo(7);
  });

  it("僅在兩側金額皆可計算時列入（基準為 null 的案例跳過）", () => {
    const metrics = computeMetrics([
      outcome({ expectedAmount: null, actualAmount: 5000 }),
      outcome({ expectedAmount: 10000, actualAmount: null }),
    ]);
    expect(metrics.quoteDeviationAvg).toBeNull();
  });

  it("基準金額為 0 時跳過該則，避免除以零", () => {
    const metrics = computeMetrics([
      outcome({ expectedAmount: 0, actualAmount: 100 }),
    ]);
    expect(metrics.quoteDeviationAvg).toBeNull();
  });
});

describe("computeMetrics — 端到端成功率", () => {
  it("本來就該轉人工的案例不列入分母（標註即無法計價）", () => {
    // 「你好」這類零資訊描述，標註的 subtype 就是 null，轉人工是正確行為而非失敗。
    // 若把它們算成失敗，會系統性低估表現，並讓 CI 閘門建立在偏低的基準上。
    const metrics = computeMetrics([
      outcome({ expectedAmount: null, actualAmount: null, outOfScope: true }),
      outcome({ expectedAmount: null, actualAmount: null, outOfScope: true }),
    ]);
    expect(metrics.endToEndSuccessRate).toBeNull();
  });

  it("應可計價的案例中，實際產出金額的比例", () => {
    const metrics = computeMetrics([
      outcome({ expectedAmount: 10000, actualAmount: 10000, outOfScope: false }),
      outcome({ expectedAmount: 10000, actualAmount: 12000, outOfScope: false }),
      // 該計價卻因抽取錯誤查無費率 → 真正的失敗
      outcome({ expectedAmount: 10000, actualAmount: null, outOfScope: true }),
      // 標註即無法計價 → 不列入分母
      outcome({ expectedAmount: null, actualAmount: null, outOfScope: true }),
    ]);
    expect(metrics.endToEndSuccessRate).toBeCloseTo(2 / 3);
  });
});

describe("computeMetrics — 延遲與成本", () => {
  it("平均延遲與每案平均成本", () => {
    const metrics = computeMetrics([
      outcome({ latencyMs: 100, costUsd: 0.001 }),
      outcome({ latencyMs: 300, costUsd: 0.003 }),
    ]);
    expect(metrics.latencyAvgMs).toBe(200);
    expect(metrics.costPerCaseUsd).toBeCloseTo(0.002);
  });

  it("P95 取排序後的高分位（少數慢呼叫不該被平均稀釋）", () => {
    const outcomes = Array.from({ length: 20 }, (_, index) =>
      outcome({ id: `c${index}`, latencyMs: (index + 1) * 100 }),
    );
    // 20 筆遞增 100..2000，P95 落在第 19 筆（index 18）= 1900
    expect(computeMetrics(outcomes).latencyP95Ms).toBe(1900);
  });
});
