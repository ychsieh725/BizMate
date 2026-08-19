/**
 * 落檔格式的序列化（A6）。
 *
 * 這一層存在的唯一理由是**跨語言的形狀一致**：Python 端的 `eval.compare` 用
 * pydantic 以 `extra="forbid"` 載入這份 JSON，任何 camelCase 殘留、任何多出來
 * 的欄位都會讓載入直接失敗。
 *
 * 那個嚴格性是刻意的，但它把責任推到這裡——**這個檔案寫錯，就是 A6 跑不動**。
 * 所以測的是逐欄位的鍵名，不是「有沒有輸出」。
 */
import { describe, expect, it } from "vitest";

import type { CaseOutcome, EvalMetrics } from "./evalTypes.ts";
import type { EvalRunResult } from "./evalRunner.ts";
import {
  ARTIFACT_SCHEMA_VERSION,
  parseRunArtifact,
  toRunArtifact,
} from "./runArtifact.ts";

const METRICS: EvalMetrics = {
  fieldExtractionAccuracy: 0.9,
  fieldExtractionF1: 0.88,
  clarificationPrecision: 1,
  clarificationRecall: 0.75,
  hallucinationRate: 0,
  quoteDeviationAvg: 0.02,
  quoteDeviationMax: 0.11,
  endToEndSuccessRate: 0.95,
  latencyAvgMs: 2400,
  latencyP95Ms: 4100,
  costPerCaseUsd: 0.0012,
};

const OUTCOME: CaseOutcome = {
  id: "g-001",
  fields: [{ name: "subtype", expected: "頭像", actual: "頭像", correct: true }],
  predictedMissing: ["coloring_complexity"],
  expectedMissing: ["coloring_complexity"],
  expectedAmount: 3000,
  actualAmount: 3000,
  outOfScope: false,
  latencyMs: 2400,
  costUsd: 0.0012,
  modelVersion: "gemini-flash-lite-latest",
};

const RESULT: EvalRunResult = {
  runId: "run-1",
  datasetVersion: "2026-08-15",
  modelVersion: "gemini-flash-lite-latest",
  outcomes: [OUTCOME],
  metrics: METRICS,
};

describe("toRunArtifact", () => {
  it("標記為 baseline —— 這一側永遠是單步流程", () => {
    expect(toRunArtifact(RESULT).variant).toBe("baseline");
  });

  it("頂層鍵全為 snake_case", () => {
    const artifact = toRunArtifact(RESULT);

    expect(Object.keys(artifact).sort()).toEqual(
      [
        "dataset_version",
        "generated_at",
        "metrics",
        "model_version",
        "outcomes",
        "schema_version",
        "variant",
      ].sort(),
    );
  });

  it("不輸出 run_id —— Python 端的 schema 沒有這個欄位，多帶會被拒絕", () => {
    expect(toRunArtifact(RESULT)).not.toHaveProperty("run_id");
    expect(toRunArtifact(RESULT)).not.toHaveProperty("runId");
  });

  it("outcome 的鍵全為 snake_case 且值原封不動", () => {
    const [outcome] = toRunArtifact(RESULT).outcomes;

    expect(outcome).toEqual({
      id: "g-001",
      fields: [{ name: "subtype", expected: "頭像", actual: "頭像", correct: true }],
      predicted_missing: ["coloring_complexity"],
      expected_missing: ["coloring_complexity"],
      expected_amount: 3000,
      actual_amount: 3000,
      out_of_scope: false,
      latency_ms: 2400,
      cost_usd: 0.0012,
      model_version: "gemini-flash-lite-latest",
      trajectory: null,
    });
  });

  it("metrics 的 11 個鍵全為 snake_case", () => {
    expect(Object.keys(toRunArtifact(RESULT).metrics).sort()).toEqual(
      [
        "clarification_precision",
        "clarification_recall",
        "cost_per_case_usd",
        "end_to_end_success_rate",
        "field_extraction_accuracy",
        "field_extraction_f1",
        "hallucination_rate",
        "latency_avg_ms",
        "latency_p95_ms",
        "quote_deviation_avg",
        "quote_deviation_max",
      ].sort(),
    );
  });

  it("軌跡固定為 null —— 單步流程沒有軌跡可言，不是「空的軌跡」", () => {
    expect(toRunArtifact(RESULT).outcomes[0].trajectory).toBeNull();
  });

  it("不輸出 trajectory_metrics —— 該欄位在 Python 端為選填，缺席即代表無軌跡", () => {
    expect(toRunArtifact(RESULT)).not.toHaveProperty("trajectory_metrics");
  });

  it("保留 null 指標 —— 分母為 0 與「表現為 0」是兩件事", () => {
    const artifact = toRunArtifact({
      ...RESULT,
      metrics: { ...METRICS, hallucinationRate: null },
    });

    expect(artifact.metrics.hallucination_rate).toBeNull();
  });

  it("generated_at 是 ISO 8601 UTC", () => {
    expect(toRunArtifact(RESULT).generated_at).toMatch(/Z$|\+00:00$/);
  });

  it("帶上 schema 版本 —— 舊檔案被新程式讀到時要看得出來", () => {
    expect(toRunArtifact(RESULT).schema_version).toBe(ARTIFACT_SCHEMA_VERSION);
  });

  it("可被 JSON.stringify 完整序列化", () => {
    // 同一個實例來回比對：generated_at 每次呼叫都不同，比對兩次呼叫的結果會偶發失敗
    const artifact = toRunArtifact(RESULT);
    const parsed: unknown = JSON.parse(JSON.stringify(artifact));

    expect(parsed).toEqual(artifact);
  });
});

/**
 * 讀回（WBS 8.5）。
 *
 * CI 閘門讀的是磁碟上的 JSON，不是記憶體裡的物件。寫出與讀回是兩份各自維護的
 * 形狀，只要有一邊漏改，閘門就會拿著錯位的數字做判定——而錯位不會拋錯，只會
 * 讓報告說謊。故此處的核心測試是**來回一致**，不是「能不能解析」。
 */
describe("parseRunArtifact", () => {
  const SERIALIZED = JSON.parse(JSON.stringify(toRunArtifact(RESULT))) as unknown;

  it("讀回的指標與寫出前完全相同 —— 來回一致是這一層唯一要保證的事", () => {
    expect(parseRunArtifact(SERIALIZED).metrics).toEqual(METRICS);
  });

  it("帶出案例數 —— 報告要能說出這批數字建立在幾則之上", () => {
    expect(parseRunArtifact(SERIALIZED).caseCount).toBe(1);
  });

  it("保留資料集與模型版本 —— 門檻只對特定組合成立", () => {
    const parsed = parseRunArtifact(SERIALIZED);

    expect(parsed.datasetVersion).toBe("2026-08-15");
    expect(parsed.modelVersion).toBe("gemini-flash-lite-latest");
  });

  it("null 指標原樣讀回，不被當成 0", () => {
    const artifact = toRunArtifact({ ...RESULT, metrics: { ...METRICS, hallucinationRate: null } });

    expect(parseRunArtifact(JSON.parse(JSON.stringify(artifact))).metrics.hallucinationRate).toBe(
      null,
    );
  });

  it("缺少指標欄位即拒絕 —— 寧可跑不動，也不要拿不完整的資料放行", () => {
    const broken = JSON.parse(JSON.stringify(toRunArtifact(RESULT))) as {
      metrics: Record<string, unknown>;
    };
    delete broken.metrics.hallucination_rate;

    expect(() => parseRunArtifact(broken)).toThrow();
  });

  it("schema 版本不符即拒絕 —— 舊檔案的欄位語意可能已經不同", () => {
    const stale = { ...toRunArtifact(RESULT), schema_version: ARTIFACT_SCHEMA_VERSION + 1 };

    expect(() => parseRunArtifact(JSON.parse(JSON.stringify(stale)))).toThrow(/schema/i);
  });

  it("完全不是 artifact 的東西即拒絕", () => {
    expect(() => parseRunArtifact({ hello: "world" })).toThrow();
  });
});
