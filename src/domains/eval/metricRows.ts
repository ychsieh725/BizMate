import type { TablesInsert } from "@/lib/supabase/database.types.ts";
import type { EvalMetrics } from "@/domains/eval/evalTypes.ts";

/**
 * 指標 → eval_runs 列的映射（WBS 7.2，FR-EV-2）。
 *
 * metric_name 是對外契約：SQL 直查、跨次比較、8.5 的 CI 閘門都依賴這些字串。
 * 改名會讓歷史資料無法與新資料比較，等同丟失基準線，故由測試釘住。
 */

/** EvalMetrics 欄位 → eval_runs.metric_name 的對應（PRD §8.2）。 */
export const METRIC_NAMES: Record<keyof EvalMetrics, string> = {
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
};

export interface MetricRowContext {
  /** 單次執行的識別碼，同批指標共用（供跨次比較時分組）。 */
  readonly runId: string;
  /** golden set 版本，資料集變動時遞增。 */
  readonly datasetVersion: string;
  /** 實際使用的模型（取自 cost_logs，非設定值——記錄真正跑了什麼）。 */
  readonly modelVersion: string;
}

/**
 * 將一次評估的指標展開為 eval_runs 的多列。
 *
 * 值為 null 的指標**仍然寫入**：缺這一列（沒跑）與值為 null（跑了但無從計算）
 * 是不同的事實，混同會讓日後判讀基準線時失去線索。
 */
export function toMetricRows(
  metrics: EvalMetrics,
  context: MetricRowContext,
): TablesInsert<"eval_runs">[] {
  return Object.entries(METRIC_NAMES).map(([key, metricName]) => ({
    run_id: context.runId,
    dataset_version: context.datasetVersion,
    model_version: context.modelVersion,
    metric_name: metricName,
    value: metrics[key as keyof EvalMetrics],
  }));
}
