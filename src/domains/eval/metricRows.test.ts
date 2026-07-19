import { describe, it, expect } from "vitest";
import { toMetricRows, METRIC_NAMES } from "./metricRows.ts";
import type { EvalMetrics } from "./evalTypes.ts";

/**
 * 指標 → eval_runs 列的映射（WBS 7.2）。
 *
 * metric_name 是**對外契約**：SQL 直查、跨次比較、8.5 的 CI 閘門都依賴這些
 * 字串。改名會讓歷史資料無法與新資料比較，故用測試把名稱釘住。
 */

const FULL_METRICS: EvalMetrics = {
  fieldExtractionAccuracy: 0.971,
  fieldExtractionF1: 0.95,
  clarificationPrecision: 0.964,
  clarificationRecall: 1,
  hallucinationRate: 0,
  quoteDeviationAvg: 0.02,
  quoteDeviationMax: 7,
  endToEndSuccessRate: 1,
  latencyAvgMs: 1200,
  latencyP95Ms: 2100,
  costPerCaseUsd: 0.00012,
};

const CONTEXT = {
  runId: "2026-07-19T10-40-00Z",
  datasetVersion: "v1.0.0",
  modelVersion: "gemini-3.1-flash-lite",
};

describe("METRIC_NAMES — 契約穩定性", () => {
  it("指標名稱維持 snake_case 且與 PRD §8.2 對應", () => {
    expect(METRIC_NAMES).toEqual({
      fieldExtractionAccuracy: "field_extraction_accuracy",
      fieldExtractionF1: "field_extraction_f1",
      clarificationPrecision: "clarification_precision",
      clarificationRecall: "clarification_recall",
      hallucinationRate: "hallucination_rate",
      quoteDeviationAvg: "quote_deviation_avg",
      quoteDeviationMax: "quote_deviation_max",
      endToEndSuccessRate: "end_to_end_success_rate",
      latencyAvgMs: "latency_avg_ms",
      latencyP95Ms: "latency_p95_ms",
      costPerCaseUsd: "cost_per_case_usd",
    });
  });
});

describe("toMetricRows", () => {
  it("每個指標展開為一列，全部帶相同的 run_id / 版本標記", () => {
    const rows = toMetricRows(FULL_METRICS, CONTEXT);

    expect(rows).toHaveLength(Object.keys(METRIC_NAMES).length);
    for (const row of rows) {
      expect(row.run_id).toBe(CONTEXT.runId);
      expect(row.dataset_version).toBe(CONTEXT.datasetVersion);
      expect(row.model_version).toBe(CONTEXT.modelVersion);
    }
  });

  it("指標值正確對應到各自的 metric_name", () => {
    const rows = toMetricRows(FULL_METRICS, CONTEXT);
    const byName = new Map(rows.map((row) => [row.metric_name, row.value]));

    expect(byName.get("field_extraction_accuracy")).toBe(0.971);
    expect(byName.get("hallucination_rate")).toBe(0);
    expect(byName.get("quote_deviation_max")).toBe(7);
    expect(byName.get("cost_per_case_usd")).toBe(0.00012);
  });

  it("無從評估的指標仍寫入且值為 null，保留「這次確實跑過」的事實", () => {
    const rows = toMetricRows(
      { ...FULL_METRICS, hallucinationRate: null, quoteDeviationAvg: null },
      CONTEXT,
    );
    const byName = new Map(rows.map((row) => [row.metric_name, row.value]));

    expect(byName.get("hallucination_rate")).toBeNull();
    expect(byName.get("quote_deviation_avg")).toBeNull();
    // 仍是完整列數——缺指標與指標為 null 是不同的事
    expect(rows).toHaveLength(Object.keys(METRIC_NAMES).length);
  });
});
