/**
 * CI 閘門的判定邏輯（WBS 8.5）。
 *
 * 這一層決定「這次 eval 能不能合併」。它必須是純函式，理由不只是好測——
 * 而是**閘門本身出錯時不會有人發現**：閘門誤放行看起來就跟沒有回歸一樣。
 * 故此處逐條驗證判定規則，包含最容易寫錯的三處：邊界的等號、指標為 null 時
 * 的行為、以及 advisory 失敗不得影響最終結論。
 */
import { describe, expect, it } from "vitest";

import type { EvalMetrics } from "./evalTypes.ts";
import type { MetricThreshold } from "./gate.ts";
import { evaluateGate } from "./gate.ts";

/** 一份全數通過的指標，個別測試只覆寫關心的那一項。 */
const PASSING: EvalMetrics = {
  fieldExtractionAccuracy: 0.99,
  fieldExtractionF1: 0.99,
  clarificationPrecision: 1,
  clarificationRecall: 1,
  hallucinationRate: 0,
  quoteDeviationAvg: 0,
  quoteDeviationMax: 0,
  endToEndSuccessRate: 1,
  latencyAvgMs: 3000,
  latencyP95Ms: 9000,
  costPerCaseUsd: 0.0005,
};

const BLOCKING_MIN: MetricThreshold = {
  metric: "fieldExtractionAccuracy",
  direction: "atLeast",
  value: 0.95,
  severity: "blocking",
  rationale: "測試用",
};

const BLOCKING_MAX: MetricThreshold = {
  metric: "hallucinationRate",
  direction: "atMost",
  value: 0,
  severity: "blocking",
  rationale: "測試用",
};

const ADVISORY_MAX: MetricThreshold = {
  metric: "costPerCaseUsd",
  direction: "atMost",
  value: 0.001,
  severity: "advisory",
  rationale: "測試用",
};

describe("evaluateGate", () => {
  it("全數達標時通過，且無任何失敗項", () => {
    const report = evaluateGate(PASSING, [BLOCKING_MIN, BLOCKING_MAX, ADVISORY_MAX]);

    expect(report.passed).toBe(true);
    expect(report.blockingFailures).toHaveLength(0);
    expect(report.advisoryFailures).toHaveLength(0);
  });

  it("atLeast 低於門檻即擋下", () => {
    const report = evaluateGate({ ...PASSING, fieldExtractionAccuracy: 0.9499 }, [BLOCKING_MIN]);

    expect(report.passed).toBe(false);
    expect(report.blockingFailures.map((check) => check.metricName)).toEqual([
      "field_extraction_accuracy",
    ]);
  });

  it("atLeast 恰等於門檻視為通過 —— 門檻是「不得低於」，不是「必須高於」", () => {
    expect(evaluateGate({ ...PASSING, fieldExtractionAccuracy: 0.95 }, [BLOCKING_MIN]).passed).toBe(
      true,
    );
  });

  it("atMost 恰等於門檻視為通過", () => {
    expect(evaluateGate({ ...PASSING, hallucinationRate: 0 }, [BLOCKING_MAX]).passed).toBe(true);
  });

  it("atMost 超出門檻即擋下 —— 幻覺率只要不是 0 就不放行", () => {
    const report = evaluateGate({ ...PASSING, hallucinationRate: 0.0001 }, [BLOCKING_MAX]);

    expect(report.passed).toBe(false);
    expect(report.blockingFailures[0].metricName).toBe("hallucination_rate");
  });

  it("advisory 未達標會記錄，但不影響最終結論", () => {
    const report = evaluateGate({ ...PASSING, costPerCaseUsd: 0.005 }, [
      BLOCKING_MIN,
      ADVISORY_MAX,
    ]);

    expect(report.passed).toBe(true);
    expect(report.advisoryFailures.map((check) => check.metricName)).toEqual(["cost_per_case_usd"]);
    expect(report.blockingFailures).toHaveLength(0);
  });

  it("指標為 null 一律不算通過 —— 「量不到」不能當成「通過了」", () => {
    const report = evaluateGate({ ...PASSING, fieldExtractionAccuracy: null }, [BLOCKING_MIN]);

    expect(report.passed).toBe(false);
    expect(report.blockingFailures[0].actual).toBeNull();
  });

  it("null 出現在 advisory 上同樣不影響最終結論", () => {
    const report = evaluateGate({ ...PASSING, costPerCaseUsd: null }, [BLOCKING_MIN, ADVISORY_MAX]);

    expect(report.passed).toBe(true);
    expect(report.advisoryFailures).toHaveLength(1);
  });

  it("checks 涵蓋每一條門檻，順序與門檻表一致", () => {
    const report = evaluateGate(PASSING, [BLOCKING_MIN, ADVISORY_MAX, BLOCKING_MAX]);

    expect(report.checks.map((check) => check.metricName)).toEqual([
      "field_extraction_accuracy",
      "cost_per_case_usd",
      "hallucination_rate",
    ]);
  });

  it("check 帶上判定所依據的門檻值與方向，報告才能自我解釋", () => {
    const [check] = evaluateGate(PASSING, [BLOCKING_MIN]).checks;

    expect(check).toEqual({
      metricName: "field_extraction_accuracy",
      severity: "blocking",
      direction: "atLeast",
      threshold: 0.95,
      actual: 0.99,
      passed: true,
    });
  });

  it("門檻表為空時通過 —— 不預設任何隱含規則", () => {
    expect(evaluateGate(PASSING, []).passed).toBe(true);
  });
});
