import type { GoldenCase } from "@/domains/eval/goldenSet.types.ts";
import type { CaseOutcome, EvalMetrics } from "@/domains/eval/evalTypes.ts";
import { GOLDEN_CASES } from "@/domains/eval/goldenSet.ts";
import { DATASET_VERSION } from "@/domains/eval/goldenSet.types.ts";
import { compareFields, toExtractedValues } from "@/domains/eval/comparison.ts";
import { EVAL_CONTACT_EMAIL } from "@/domains/eval/evalConstants.ts";
import { computeMetrics } from "@/domains/eval/metrics.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import { costLogsRepository } from "@/domains/finops/repositories/costLogsRepository.ts";

/**
 * Eval Runner（WBS 7.2，FR-EV-2）：對真實 agent pipeline 執行 golden set。
 *
 * ── 為何不需要跑完整的 describe→反問→報價流程 ──
 * Parser 之後的環節全是 deterministic 的：缺漏判定依 confidence 門檻、計價是
 * rate card 查表。故一則案例只需一次 LLM 呼叫，就能算出 PRD §8.2 的全部指標
 * ——包含報價偏差（用純函式計價算兩側金額）。跑完整流程只會多出反問生成的
 * LLM 呼叫，指標卻不會更準，只是更慢更貴。
 *
 * 已知限制：延遲指標只涵蓋 Parser 呼叫，不含反問生成的端到端時間。
 */

/** Gemini 免費層對 flash-lite 是 15 requests/min，不節流跑整份必撞 429。 */
export const DEFAULT_DELAY_MS = 4500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 跑單一 golden case：真實 Parser 抽取 → 逐欄比對 → 兩側計價 → 取成本延遲。
 * 會建立一筆測試 session（cost_logs 的 FK 需要），驗收後可自行清除。
 */
export async function runEvalCase(
  goldenCase: GoldenCase,
  merchantId: string,
): Promise<CaseOutcome> {
  // 標記為 eval 測試資料，供 pnpm eval:clean 事後辨識清理（見 evalConstants）
  const session = await sessionsRepository.create({
    category: goldenCase.category,
    merchant_id: merchantId,
    contact_email: EVAL_CONTACT_EMAIL,
  });
  const allowedSubtypes = await rateCardRepository.findActiveSubtypes(
    merchantId,
    goldenCase.category,
  );

  const parsed = await parseIntake({
    sessionId: session.id,
    category: goldenCase.category,
    rawText: goldenCase.rawText,
    allowedSubtypes,
  });

  const fields = compareFields(goldenCase.expected.fields, parsed.fields);

  // 兩側計價：基準用標註欄位（抽取完全正確時應有的報價），實際用模型抽取結果。
  // 差額即「抽取錯誤值多少錢」。計價是純查表，不額外呼叫 LLM。
  const [expectedPricing, actualPricing] = await Promise.all([
    computeBasePricing(
      merchantId,
      goldenCase.category,
      toExtractedValues(goldenCase.expected.fields),
    ),
    computeBasePricing(merchantId, goldenCase.category, parsed.fields),
  ]);

  // cost_logs 由 generateStructuredAndLog 寫入；查不到不讓評估中斷，以 0 計並
  // 由呼叫端從 latency/cost 為 0 察覺異常。
  const logs = await costLogsRepository.findBySession(session.id);
  const latencyMs = logs.reduce((sum, log) => sum + (log.latency_ms ?? 0), 0);
  const costUsd = logs.reduce((sum, log) => sum + Number(log.cost_usd ?? 0), 0);

  return {
    id: goldenCase.id,
    fields,
    predictedMissing: parsed.missingRequiredFields,
    expectedMissing: goldenCase.expected.missingRequiredFields,
    expectedAmount: expectedPricing.outOfScope ? null : expectedPricing.total,
    actualAmount: actualPricing.outOfScope ? null : actualPricing.total,
    outOfScope: actualPricing.outOfScope,
    latencyMs,
    costUsd,
    modelVersion: logs[0]?.model ?? null,
  };
}

export interface RunEvalOptions {
  readonly merchantId: string;
  /** 只跑前 N 則（省 token，用於驗證腳本本身）。 */
  readonly limit?: number;
  /** 每則之間的間隔毫秒；0 為不節流（付費層可用）。 */
  readonly delayMs?: number;
  /** 每跑完一則回報進度，供 CLI 即時輸出。 */
  readonly onCaseComplete?: (outcome: CaseOutcome, index: number, total: number) => void;
}

export interface EvalRunResult {
  readonly runId: string;
  readonly datasetVersion: string;
  /** 實際跑的模型，取自 cost_logs；全部查無時為 unknown。 */
  readonly modelVersion: string;
  readonly outcomes: readonly CaseOutcome[];
  readonly metrics: EvalMetrics;
}

/**
 * 跑整份（或前 N 則）golden set 並聚合指標。
 * 刻意不寫資料庫——持久化由呼叫端決定（CLI 的 --dry-run 需要「跑了但不寫」）。
 */
export async function runEval(options: RunEvalOptions): Promise<EvalRunResult> {
  const { merchantId, limit, delayMs = DEFAULT_DELAY_MS, onCaseComplete } = options;
  const cases = limit == null ? GOLDEN_CASES : GOLDEN_CASES.slice(0, limit);

  const outcomes: CaseOutcome[] = [];
  const models = new Set<string>();

  for (const [index, goldenCase] of cases.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    const outcome = await runEvalCase(goldenCase, merchantId);
    outcomes.push(outcome);
    if (outcome.modelVersion != null) models.add(outcome.modelVersion);
    onCaseComplete?.(outcome, index, cases.length);
  }

  return {
    runId: new Date().toISOString(),
    datasetVersion: DATASET_VERSION,
    modelVersion: models.size === 1 ? [...models][0] : ([...models].join(",") || "unknown"),
    outcomes,
    metrics: computeMetrics(outcomes),
  };
}
