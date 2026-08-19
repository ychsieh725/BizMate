/**
 * Eval 基準線閘門（WBS 8.5）。
 *
 * 執行：
 *   pnpm eval --dry-run --out=eval-artifacts/ci.json   先跑，落檔
 *   pnpm eval:gate eval-artifacts/ci.json              再判，未達回離開碼 1
 *
 * ── 為何與 Eval Runner 分成兩支 ──
 * 跑一次 eval 要數分鐘與 API 額度；「這批數字能不能過」是純比對。分開之後：
 * (1) 判定邏輯可被單元測試，且測試用的是真實歷史 artifact（見 baseline.test.ts）
 * (2) CI 可以在閘門失敗時**仍然保留那份 artifact**——花額度換來的資料不該
 *     因為紅燈就消失，那正是要拿來分析為什麼紅的東西
 *
 * 門檻與其出處在 `src/domains/eval/baseline.ts`。
 */
import { readFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";

import { BASELINE_PROVENANCE, BASELINE_THRESHOLDS } from "@/domains/eval/baseline.ts";
import { evaluateGate } from "@/domains/eval/gate.ts";
import type { GateReport, MetricThreshold, ThresholdCheck } from "@/domains/eval/gate.ts";
import { METRIC_NAMES } from "@/domains/eval/metricRows.ts";
import { parseRunArtifact } from "@/domains/eval/runArtifact.ts";

/** metric_name → 門檻定義，讓報告能在每條檢查旁印出它的理由。 */
const THRESHOLD_BY_NAME = new Map<string, MetricThreshold>(
  BASELINE_THRESHOLDS.map((threshold) => [METRIC_NAMES[threshold.metric], threshold]),
);

function formatValue(metricName: string, value: number | null): string {
  if (value == null) return "n/a";
  if (metricName === "cost_per_case_usd") return `$${value.toFixed(6)}`;
  if (metricName.startsWith("latency_")) return `${value.toFixed(0)}ms`;
  return `${(value * 100).toFixed(2)}%`;
}

function formatCheck(check: ThresholdCheck): string {
  const mark = check.passed ? "✅" : check.severity === "blocking" ? "❌" : "⚠️ ";
  const relation = check.direction === "atLeast" ? "≥" : "≤";
  const bound = formatValue(check.metricName, check.threshold);
  return `${mark} ${check.metricName.padEnd(28)} ${formatValue(check.metricName, check.actual).padStart(10)}  （門檻 ${relation} ${bound}）`;
}

function printReport(report: GateReport): void {
  console.log("\n──────── 基準線閘門 ────────");
  for (const check of report.checks) {
    console.log(formatCheck(check));
  }

  for (const check of [...report.blockingFailures, ...report.advisoryFailures]) {
    const rationale = THRESHOLD_BY_NAME.get(check.metricName)?.rationale;
    if (rationale != null) console.log(`\n   ${check.metricName}：${rationale}`);
  }
}

/**
 * 把結果寫進 GitHub Actions 的執行摘要。
 *
 * 沒有這一段的話，紅燈只會留在幾百行 log 的中間——而閘門紅了的當下，最需要
 * 的資訊是「哪一條、差多少」。非 CI 環境沒有這個變數，安靜跳過。
 */
async function writeStepSummary(report: GateReport, header: string): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath == null || summaryPath === "") return;

  const rows = report.checks.map((check) => {
    const mark = check.passed ? "✅" : check.severity === "blocking" ? "❌" : "⚠️";
    const relation = check.direction === "atLeast" ? "≥" : "≤";
    return `| ${mark} | \`${check.metricName}\` | ${formatValue(check.metricName, check.actual)} | ${relation} ${formatValue(check.metricName, check.threshold)} | ${check.severity} |`;
  });

  const lines = [
    `## Eval 基準線閘門：${report.passed ? "通過" : "未通過"}`,
    "",
    header,
    "",
    "| | 指標 | 實測 | 門檻 | 級別 |",
    "| :-: | :--- | ---: | :--- | :--- |",
    ...rows,
    "",
  ];

  if (report.blockingFailures.length > 0) {
    lines.push("### 擋下合併的原因", "");
    for (const check of report.blockingFailures) {
      lines.push(`- \`${check.metricName}\`：${THRESHOLD_BY_NAME.get(check.metricName)?.rationale}`);
    }
    lines.push("");
  }

  await appendFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path == null || path.startsWith("--")) {
    throw new Error("用法：pnpm eval:gate <artifact.json>（先用 pnpm eval --out=<同一路徑> 產生）");
  }

  const artifact = parseRunArtifact(JSON.parse(await readFile(resolve(path), "utf8")) as unknown);

  const header =
    `資料集 ${artifact.datasetVersion}｜模型 ${artifact.modelVersion}｜` +
    `${artifact.caseCount} 則｜量測於 ${artifact.generatedAt}`;
  console.log(`Eval 基準線閘門｜${header}`);
  console.log(
    `門檻出處：${BASELINE_PROVENANCE.artifact}（${BASELINE_PROVENANCE.measuredAt}，` +
      `${BASELINE_PROVENANCE.caseCount} 則，取 Wilson 95% 下界）`,
  );

  // 門檻只對「同一資料集 + 同一模型」成立。跨版本比對出來的綠燈沒有意義，
  // 但也不該直接失敗——換模型是刻意的動作，這裡的職責是讓它無法被忽略。
  if (artifact.datasetVersion !== BASELINE_PROVENANCE.datasetVersion) {
    console.log(
      `\n⚠️  資料集版本與基準線不同（${artifact.datasetVersion} vs ${BASELINE_PROVENANCE.datasetVersion}），門檻需重新推導`,
    );
  }
  if (artifact.modelVersion !== BASELINE_PROVENANCE.modelVersion) {
    console.log(
      `\n⚠️  模型與基準線不同（${artifact.modelVersion} vs ${BASELINE_PROVENANCE.modelVersion}），門檻需重新推導`,
    );
  }

  const report = evaluateGate(artifact.metrics, BASELINE_THRESHOLDS);
  printReport(report);
  await writeStepSummary(report, header);

  if (report.advisoryFailures.length > 0) {
    console.log(`\n⚠️  ${report.advisoryFailures.length} 項警告未達標（不影響合併）。`);
  }

  if (!report.passed) {
    console.log(`\n❌ ${report.blockingFailures.length} 項硬門檻未達標，擋下合併。`);
    process.exit(1);
  }

  console.log("\n🎉 全部硬門檻通過。");
}

main().catch((error: unknown) => {
  console.error("基準線閘門執行失敗：", error);
  process.exit(1);
});
