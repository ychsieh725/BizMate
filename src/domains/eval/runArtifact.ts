/**
 * Eval 執行結果的落檔格式（A6）。
 *
 * ## 為什麼需要它
 *
 * A6 要回答「agent 比單步 baseline 好嗎」，正確的檢定是 **McNemar 配對檢定**
 * ——兩側跑的是同一批 golden case，不是兩組獨立樣本。配對需要逐案例的對應
 * 關係，而 `eval_runs` 存的是 metric_name → value，逐案例資訊在聚合時就沒了。
 *
 * ## 為什麼是 snake_case
 *
 * 讀這份檔案的是 Python 端的 `eval.compare`。與其在那邊寫一層 camelCase →
 * snake_case 的轉換，不如在寫出時就對齊——轉換層是會靜默出錯的地方：欄位對錯
 * 位不會拋例外，只會讓對照表上的數字說謊。
 *
 * Python 端以 `extra="forbid"` 載入，多帶或漏帶欄位都會當場失敗。那個嚴格性
 * 把責任集中到這個檔案：**這裡寫錯，A6 就跑不動**——這比「跑得動但數字是錯的」
 * 好得多。
 *
 * ## 刻意不輸出的東西
 *
 * - `run_id`：那是 `eval_runs` 的主鍵，只在 TypeScript 側有意義，Python 的
 *   schema 沒有這個欄位，帶過去會被拒絕
 * - `trajectory`／`trajectory_metrics`：單步流程沒有軌跡可言。填 0 會讓
 *   fallback 率、平均步數在對照表上看起來像「baseline 表現完美」，那是拿不
 *   存在的東西當基準
 */
import { z } from "zod";

import type { CaseOutcome, EvalMetrics, FieldComparison } from "./evalTypes.ts";
import type { EvalRunResult } from "./evalRunner.ts";

/** 檔案格式版本，與 Python 端 `eval/artifact.py` 的 SCHEMA_VERSION 同值。 */
export const ARTIFACT_SCHEMA_VERSION = 1;

interface SerializedOutcome {
  readonly id: string;
  readonly fields: readonly FieldComparison[];
  readonly predicted_missing: readonly string[];
  readonly expected_missing: readonly string[];
  readonly expected_amount: number | null;
  readonly actual_amount: number | null;
  readonly out_of_scope: boolean;
  readonly latency_ms: number;
  readonly cost_usd: number;
  readonly model_version: string | null;
  readonly trajectory: null;
}

interface SerializedMetrics {
  readonly field_extraction_accuracy: number | null;
  readonly field_extraction_f1: number | null;
  readonly clarification_precision: number | null;
  readonly clarification_recall: number | null;
  readonly hallucination_rate: number | null;
  readonly quote_deviation_avg: number | null;
  readonly quote_deviation_max: number | null;
  readonly end_to_end_success_rate: number | null;
  readonly latency_avg_ms: number | null;
  readonly latency_p95_ms: number | null;
  readonly cost_per_case_usd: number | null;
}

export interface RunArtifact {
  readonly schema_version: number;
  readonly variant: "baseline";
  readonly generated_at: string;
  readonly dataset_version: string;
  readonly model_version: string;
  readonly outcomes: readonly SerializedOutcome[];
  readonly metrics: SerializedMetrics;
}

function toSerializedOutcome(outcome: CaseOutcome): SerializedOutcome {
  return {
    id: outcome.id,
    fields: outcome.fields,
    predicted_missing: outcome.predictedMissing,
    expected_missing: outcome.expectedMissing,
    expected_amount: outcome.expectedAmount,
    actual_amount: outcome.actualAmount,
    out_of_scope: outcome.outOfScope,
    latency_ms: outcome.latencyMs,
    cost_usd: outcome.costUsd,
    model_version: outcome.modelVersion,
    trajectory: null,
  };
}

function toSerializedMetrics(metrics: EvalMetrics): SerializedMetrics {
  return {
    field_extraction_accuracy: metrics.fieldExtractionAccuracy,
    field_extraction_f1: metrics.fieldExtractionF1,
    clarification_precision: metrics.clarificationPrecision,
    clarification_recall: metrics.clarificationRecall,
    hallucination_rate: metrics.hallucinationRate,
    quote_deviation_avg: metrics.quoteDeviationAvg,
    quote_deviation_max: metrics.quoteDeviationMax,
    end_to_end_success_rate: metrics.endToEndSuccessRate,
    latency_avg_ms: metrics.latencyAvgMs,
    latency_p95_ms: metrics.latencyP95Ms,
    cost_per_case_usd: metrics.costPerCaseUsd,
  };
}

/** 把一次執行的結果轉成可寫入磁碟、可被 Python 端載入的形狀。 */
export function toRunArtifact(result: EvalRunResult): RunArtifact {
  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    variant: "baseline",
    generated_at: new Date().toISOString(),
    dataset_version: result.datasetVersion,
    model_version: result.modelVersion,
    outcomes: result.outcomes.map(toSerializedOutcome),
    metrics: toSerializedMetrics(result.metrics),
  };
}

/**
 * ── 讀回（WBS 8.5）──
 *
 * CI 閘門讀的是磁碟上的 JSON。這裡的 schema 與上面的序列化是兩份各自維護的
 * 形狀，任一邊漏改，閘門就會拿著錯位的數字做判定——而錯位不會拋錯，只會讓報
 * 告說謊。`runArtifact.test.ts` 用來回一致把這件事釘住。
 *
 * `.strict()` 是刻意的：多出未知欄位代表寫出端已經改過而這裡沒跟上，那時候
 * 應該當場停下來，而不是安靜地忽略新欄位繼續判定。
 */
const metricsSchema = z
  .object({
    field_extraction_accuracy: z.number().nullable(),
    field_extraction_f1: z.number().nullable(),
    clarification_precision: z.number().nullable(),
    clarification_recall: z.number().nullable(),
    hallucination_rate: z.number().nullable(),
    quote_deviation_avg: z.number().nullable(),
    quote_deviation_max: z.number().nullable(),
    end_to_end_success_rate: z.number().nullable(),
    latency_avg_ms: z.number().nullable(),
    latency_p95_ms: z.number().nullable(),
    cost_per_case_usd: z.number().nullable(),
  })
  .strict();

const artifactSchema = z.object({
  schema_version: z.number(),
  variant: z.string(),
  generated_at: z.string(),
  dataset_version: z.string(),
  model_version: z.string(),
  // 逐案例的完整形狀不在此重複驗證——閘門只用得到則數，而案例形狀的正確性
  // 由寫出端的測試負責。在這裡再寫一份等於多一處會漂移的地方。
  outcomes: z.array(z.unknown()),
  metrics: metricsSchema,
});

export interface ParsedRunArtifact {
  readonly variant: string;
  readonly generatedAt: string;
  readonly datasetVersion: string;
  readonly modelVersion: string;
  readonly caseCount: number;
  readonly metrics: EvalMetrics;
}

/** 把磁碟上的 artifact 讀回成程式內的形狀；格式不符一律拋錯。 */
export function parseRunArtifact(raw: unknown): ParsedRunArtifact {
  const artifact = artifactSchema.parse(raw);

  if (artifact.schema_version !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `artifact schema 版本不符：檔案為 ${artifact.schema_version}，本程式支援 ${ARTIFACT_SCHEMA_VERSION}`,
    );
  }

  const m = artifact.metrics;
  return {
    variant: artifact.variant,
    generatedAt: artifact.generated_at,
    datasetVersion: artifact.dataset_version,
    modelVersion: artifact.model_version,
    caseCount: artifact.outcomes.length,
    metrics: {
      fieldExtractionAccuracy: m.field_extraction_accuracy,
      fieldExtractionF1: m.field_extraction_f1,
      clarificationPrecision: m.clarification_precision,
      clarificationRecall: m.clarification_recall,
      hallucinationRate: m.hallucination_rate,
      quoteDeviationAvg: m.quote_deviation_avg,
      quoteDeviationMax: m.quote_deviation_max,
      endToEndSuccessRate: m.end_to_end_success_rate,
      latencyAvgMs: m.latency_avg_ms,
      latencyP95Ms: m.latency_p95_ms,
      costPerCaseUsd: m.cost_per_case_usd,
    },
  };
}
