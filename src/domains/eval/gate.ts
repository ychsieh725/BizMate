/**
 * Eval 指標對基準線門檻的判定（WBS 8.5）。
 *
 * 與 Eval Runner 刻意分開：跑一次 eval 要花數分鐘與 API 額度，而「這批數字
 * 能不能過」是純比對。分開之後，門檻邏輯可以拿**已進版控的歷史 artifact**
 * 當測試資料——`a6-baseline.json`（報價偏差 700%）必須被擋、
 * `a6b-baseline.json`（修復後）必須放行。用真實回歸驗證閘門，比自己編 fixture
 * 有說服力得多。
 *
 * 門檻值本身在 `baseline.ts`，那裡記錄了每一條的出處與理由。
 */
import type { EvalMetrics } from "./evalTypes.ts";
import { METRIC_NAMES } from "./metricRows.ts";

/** blocking 未達即回非 0 離開碼；advisory 只印出來。 */
export type ThresholdSeverity = "blocking" | "advisory";

/** atLeast = 不得低於；atMost = 不得高於。等於門檻一律視為通過。 */
export type ThresholdDirection = "atLeast" | "atMost";

export interface MetricThreshold {
  readonly metric: keyof EvalMetrics;
  readonly direction: ThresholdDirection;
  readonly value: number;
  readonly severity: ThresholdSeverity;
  /** 這條門檻為何是這個值。報告會印出來，讓紅燈自己解釋自己。 */
  readonly rationale: string;
}

export interface ThresholdCheck {
  /** eval_runs 的 metric_name 契約字串，與 SQL 直查、artifact JSON 同名。 */
  readonly metricName: string;
  readonly severity: ThresholdSeverity;
  readonly direction: ThresholdDirection;
  readonly threshold: number;
  readonly actual: number | null;
  readonly passed: boolean;
}

export interface GateReport {
  readonly checks: readonly ThresholdCheck[];
  readonly blockingFailures: readonly ThresholdCheck[];
  readonly advisoryFailures: readonly ThresholdCheck[];
  /** 只看 blocking：advisory 未達標不影響能否合併。 */
  readonly passed: boolean;
}

/**
 * 指標為 null 一律不算通過。
 *
 * null 代表分母為 0——該指標這次根本沒被量到。把「量不到」當成「通過了」是
 * 這類閘門最典型的失效方式：資料集載入壞掉、案例全被跳過，指標全成 null，
 * CI 卻一片綠。
 */
function checkThreshold(threshold: MetricThreshold, metrics: EvalMetrics): ThresholdCheck {
  const actual = metrics[threshold.metric];
  const passed =
    actual != null &&
    (threshold.direction === "atLeast" ? actual >= threshold.value : actual <= threshold.value);

  return {
    metricName: METRIC_NAMES[threshold.metric],
    severity: threshold.severity,
    direction: threshold.direction,
    threshold: threshold.value,
    actual,
    passed,
  };
}

export function evaluateGate(
  metrics: EvalMetrics,
  thresholds: readonly MetricThreshold[],
): GateReport {
  const checks = thresholds.map((threshold) => checkThreshold(threshold, metrics));
  const failures = checks.filter((check) => !check.passed);
  const blockingFailures = failures.filter((check) => check.severity === "blocking");

  return {
    checks,
    blockingFailures,
    advisoryFailures: failures.filter((check) => check.severity === "advisory"),
    passed: blockingFailures.length === 0,
  };
}
