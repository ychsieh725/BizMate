import type { CaseOutcome, EvalMetrics } from "@/domains/eval/evalTypes.ts";

/**
 * PRD §8.2 評估指標的計算（WBS 7.2，FR-EV-2）。
 *
 * 全部是純函式：輸入一批 CaseOutcome，輸出指標。跑 pipeline 與寫資料庫由
 * evalRunner 負責，此處不碰 IO——指標公式必須能用手算的小數字驗證。
 */

/** 分母為 0 時回 null 而非 0：「無從評估」與「表現為 0」是不同的事實。 */
function safeRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** 平均值；空陣列回 null。 */
function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 取高分位值（最近秩次法）。少數異常慢的呼叫會被平均稀釋，P95 才看得到尾端延遲。
 */
function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

/** 欄位層級的 F1：只看「該抽到值」的欄位，抽錯值同時計入 FP 與 FN。 */
function fieldF1(outcomes: readonly CaseOutcome[]): number | null {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const outcome of outcomes) {
    for (const field of outcome.fields) {
      const shouldHaveValue = field.expected !== null;
      const gaveValue = field.actual !== null;

      if (shouldHaveValue && field.correct) {
        truePositives += 1;
        continue;
      }
      // 抽出了值但不正確（含「該為 null 卻杜撰」）→ 誤報
      if (gaveValue) falsePositives += 1;
      // 該有值卻沒抽對（含漏抽與抽錯）→ 漏報
      if (shouldHaveValue) falseNegatives += 1;
    }
  }

  const precision = safeRatio(truePositives, truePositives + falsePositives);
  const recall = safeRatio(truePositives, truePositives + falseNegatives);
  if (precision == null || recall == null) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/** 反問判定的 precision / recall：預測缺漏 vs 標註缺漏。 */
function clarificationScores(outcomes: readonly CaseOutcome[]): {
  precision: number | null;
  recall: number | null;
} {
  let truePositives = 0;
  let predicted = 0;
  let actual = 0;

  for (const outcome of outcomes) {
    const expectedSet = new Set(outcome.expectedMissing);
    truePositives += outcome.predictedMissing.filter((field) =>
      expectedSet.has(field),
    ).length;
    predicted += outcome.predictedMissing.length;
    actual += outcome.expectedMissing.length;
  }

  return {
    precision: safeRatio(truePositives, predicted),
    recall: safeRatio(truePositives, actual),
  };
}

/** 幻覺率：標註為 null（原文未提）卻被抽出值的欄位比例。 */
function hallucinationRate(outcomes: readonly CaseOutcome[]): number | null {
  let shouldBeNull = 0;
  let fabricated = 0;

  for (const outcome of outcomes) {
    for (const field of outcome.fields) {
      if (field.expected !== null) continue;
      shouldBeNull += 1;
      if (field.actual !== null) fabricated += 1;
    }
  }

  return safeRatio(fabricated, shouldBeNull);
}

/**
 * 報價偏差：以「標註欄位算出的金額」為基準，量測抽取錯誤造成的金額偏差。
 *
 * 不用人工標註報價區間——計價是 deterministic 查表，人工標等於抄 rate card
 * 算一遍，變成用實作驗證實作。以標註欄位跑同一套計價，量到的才是「抽取錯誤
 * 值多少錢」，例如把「一組貼圖八款」抽成 quantity=8 會偏差 700%。
 */
function quoteDeviations(outcomes: readonly CaseOutcome[]): number[] {
  const deviations: number[] = [];
  for (const outcome of outcomes) {
    const { expectedAmount, actualAmount } = outcome;
    if (expectedAmount == null || actualAmount == null) continue;
    if (expectedAmount === 0) continue; // 避免除以零
    deviations.push(Math.abs(actualAmount - expectedAmount) / expectedAmount);
  }
  return deviations;
}

/** 聚合一批案例結果為 PRD §8.2 的評估指標。 */
export function computeMetrics(outcomes: readonly CaseOutcome[]): EvalMetrics {
  const allFields = outcomes.flatMap((outcome) => outcome.fields);
  const correctFields = allFields.filter((field) => field.correct).length;
  const clarification = clarificationScores(outcomes);
  const deviations = quoteDeviations(outcomes);

  // 端到端成功率的分母只算「標註認為應該可以計價」的案例。零資訊描述（「你好」）
  // 標註的 subtype 本就是 null，轉人工是正確行為而非失敗——列入分母會系統性
  // 低估表現，並讓 CI 閘門建立在偏低的基準上。
  const priceable = outcomes.filter((outcome) => outcome.expectedAmount != null);
  const priced = priceable.filter((outcome) => outcome.actualAmount != null).length;

  return {
    fieldExtractionAccuracy: safeRatio(correctFields, allFields.length),
    fieldExtractionF1: fieldF1(outcomes),
    clarificationPrecision: clarification.precision,
    clarificationRecall: clarification.recall,
    hallucinationRate: hallucinationRate(outcomes),
    quoteDeviationAvg: average(deviations),
    quoteDeviationMax: deviations.length === 0 ? null : Math.max(...deviations),
    endToEndSuccessRate: safeRatio(priced, priceable.length),
    latencyAvgMs: average(outcomes.map((outcome) => outcome.latencyMs)),
    latencyP95Ms: percentile(
      outcomes.map((outcome) => outcome.latencyMs),
      0.95,
    ),
    costPerCaseUsd: average(outcomes.map((outcome) => outcome.costUsd)),
  };
}
