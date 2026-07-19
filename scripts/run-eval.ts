/**
 * Eval Runner CLI（WBS 7.2，FR-EV-2）。
 *
 * 執行：
 *   pnpm eval                  全 36 則，指標寫入 eval_runs
 *   pnpm eval --dry-run        跑完只印結果，不寫資料庫
 *   pnpm eval --limit=3        只跑前 3 則（驗證腳本本身，省 token）
 *   pnpm eval --delay=0        關閉節流（付費層才適用，免費層會撞 429）
 *
 * 取代 7.1 的 verify-golden-set.ts：兩者都要跑 golden set 並算指標，
 * 邏輯重複；合併為一支，用 --dry-run 區分「正式評估」與「快速檢查」。
 *
 * 會為每則案例建立測試 session（cost_logs 的 FK 需要），驗收後可自行清除。
 */
import { runEval, DEFAULT_DELAY_MS } from "@/domains/eval/evalRunner.ts";
import { toMetricRows, METRIC_NAMES } from "@/domains/eval/metricRows.ts";
import { evalRunsRepository } from "@/domains/eval/repositories/evalRunsRepository.ts";
import { GOLDEN_CASES } from "@/domains/eval/goldenSet.ts";
import type { CaseOutcome, EvalMetrics } from "@/domains/eval/evalTypes.ts";
import { ensureDevMerchant } from "./dev-merchant.ts";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function numericArg(flag: string, fallback: number): number {
  const arg = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (arg == null) return fallback;
  const parsed = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** 百分比顯示；null 表示該指標無從計算，明確印 n/a 而非 0。 */
function pct(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function printCase(outcome: CaseOutcome): void {
  const wrong = outcome.fields.filter((field) => !field.correct);
  const mark = wrong.length === 0 ? "✅" : "⚠️ ";
  console.log(
    `${mark} ${outcome.id}  欄位 ${outcome.fields.length - wrong.length}/${outcome.fields.length}`,
  );
  for (const field of wrong) {
    console.log(
      `     ${field.name}: 期望「${field.expected ?? "—"}」實得「${field.actual ?? "—"}」`,
    );
  }
  // 金額偏差單獨標示——欄位小錯可能造成大額偏差，值得獨立提醒
  const { expectedAmount, actualAmount } = outcome;
  if (expectedAmount != null && actualAmount != null && expectedAmount !== actualAmount) {
    const deviation = ((actualAmount - expectedAmount) / expectedAmount) * 100;
    console.log(
      `     💰 報價偏差 ${deviation > 0 ? "+" : ""}${deviation.toFixed(1)}%（期望 ${expectedAmount} / 實得 ${actualAmount}）`,
    );
  }
  if (outcome.outOfScope) {
    console.log("     💰 outOfScope：查無費率，報價金額為 null（需人工接手）");
  }
}

function printMetrics(metrics: EvalMetrics): void {
  console.log("\n──────── PRD §8.2 評估指標 ────────");
  console.log(`欄位抽取準確率　　 ${pct(metrics.fieldExtractionAccuracy)}`);
  console.log(`欄位抽取 F1　　　　${pct(metrics.fieldExtractionF1)}`);
  console.log(`反問精準率　　　　 ${pct(metrics.clarificationPrecision)}`);
  console.log(`反問召回率　　　　 ${pct(metrics.clarificationRecall)}`);
  console.log(`幻覺率　　　　　　 ${pct(metrics.hallucinationRate)}`);
  console.log(`報價偏差（平均）　 ${pct(metrics.quoteDeviationAvg)}`);
  console.log(`報價偏差（最大）　 ${pct(metrics.quoteDeviationMax)}`);
  console.log(`端到端成功率　　　 ${pct(metrics.endToEndSuccessRate)}`);
  console.log(
    `Parser 延遲　　　　平均 ${metrics.latencyAvgMs?.toFixed(0) ?? "n/a"}ms / P95 ${metrics.latencyP95Ms?.toFixed(0) ?? "n/a"}ms`,
  );
  console.log(
    `每案成本　　　　　 ${metrics.costPerCaseUsd == null ? "n/a" : `$${metrics.costPerCaseUsd.toFixed(6)}`}`,
  );
}

async function main(): Promise<void> {
  const dryRun = hasFlag("--dry-run");
  const limit = numericArg("--limit", GOLDEN_CASES.length);
  const delayMs = numericArg("--delay", DEFAULT_DELAY_MS);
  const merchantId = await ensureDevMerchant();

  const total = Math.min(limit, GOLDEN_CASES.length);
  console.log(
    `Eval Runner｜${total} / ${GOLDEN_CASES.length} 則｜節流 ${delayMs}ms｜${dryRun ? "dry-run（不寫入）" : "寫入 eval_runs"}`,
  );
  console.log(`預估耗時約 ${Math.ceil((total * delayMs) / 60000)} 分鐘\n`);

  const result = await runEval({
    merchantId,
    limit,
    delayMs,
    onCaseComplete: (outcome) => printCase(outcome),
  });

  printMetrics(result.metrics);

  console.log(`\nrun_id：${result.runId}`);
  console.log(`dataset_version：${result.datasetVersion}`);
  console.log(`model_version：${result.modelVersion}`);

  if (dryRun) {
    console.log("\n🎉 dry-run 完成，未寫入 eval_runs。");
    return;
  }

  const rows = toMetricRows(result.metrics, {
    runId: result.runId,
    datasetVersion: result.datasetVersion,
    modelVersion: result.modelVersion,
  });
  await evalRunsRepository.createMany(rows);

  // 寫入後回查驗證——這是 append-only 觀測資料，寫失敗若靜默會讓基準線悄悄斷掉
  const persisted = await evalRunsRepository.findByRunId(result.runId);
  if (persisted.length !== Object.keys(METRIC_NAMES).length) {
    throw new Error(
      `eval_runs 寫入不完整：預期 ${Object.keys(METRIC_NAMES).length} 列，實得 ${persisted.length} 列`,
    );
  }

  console.log(`\n🎉 已寫入 eval_runs：${persisted.length} 列指標。`);
  console.log(
    `查詢：select metric_name, value from eval_runs where run_id = '${result.runId}';`,
  );
}

main().catch((error: unknown) => {
  console.error("Eval Runner 執行失敗：", error);
  process.exit(1);
});
