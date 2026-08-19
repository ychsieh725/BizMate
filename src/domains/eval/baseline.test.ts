/**
 * 基準線門檻對真實歷史資料的判定（WBS 8.5）。
 *
 * ## 為什麼用真實 artifact 而不是自己編的 fixture
 *
 * 這個閘門存在的唯一理由，是擋下 6.8 記錄的那一類回歸：illu-003「一組貼圖
 * 八款」被抽成 quantity=8，報價變成 8 倍。那次回歸**通過了全部單元測試、也
 * 通過了 E2E 金路徑**——因為單元測試餵的是自己寫的乾淨 fixture。
 *
 * 所以這裡不編 fixture。用的是兩份已進版控的實測落檔：
 *
 * - `a6-baseline.json`（08-17，修復前）：報價偏差最大值 700%，**必須被擋下**
 * - `a6b-baseline.json`（08-18，修復後）：**必須放行**
 *
 * 這兩則測試回答的是「這道閘門當時擋得住嗎」，而不是「這段程式碼跑不跑得動」。
 *
 * 附帶效果：門檻若被調鬆到讓 08-17 那份也能過，這裡會立刻紅燈。**調鬆門檻
 * 這件事本身被測試守著。**
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BASELINE_PROVENANCE, BASELINE_THRESHOLDS } from "./baseline.ts";
import { evaluateGate } from "./gate.ts";
import { parseRunArtifact } from "./runArtifact.ts";

function loadArtifact(name: string) {
  const path = resolve(process.cwd(), "eval-artifacts", name);
  return parseRunArtifact(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

describe("BASELINE_THRESHOLDS 對真實歷史資料", () => {
  it("擋下 08-17 的量測 —— 那次 illu-003 的報價偏差是 700%", () => {
    const report = evaluateGate(loadArtifact("a6-baseline.json").metrics, BASELINE_THRESHOLDS);

    expect(report.passed).toBe(false);
    expect(report.blockingFailures.map((check) => check.metricName)).toContain(
      "quote_deviation_max",
    );
  });

  it("放行 08-18 的量測 —— 修復後的現況必須是綠的，否則門檻從第一天就在誤報", () => {
    const report = evaluateGate(loadArtifact("a6b-baseline.json").metrics, BASELINE_THRESHOLDS);

    expect(report.blockingFailures).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("08-17 的欄位準確率（97.5%）不該被擋 —— 那是模型變異，不是回歸", () => {
    const report = evaluateGate(loadArtifact("a6-baseline.json").metrics, BASELINE_THRESHOLDS);

    expect(report.blockingFailures.map((check) => check.metricName)).not.toContain(
      "field_extraction_accuracy",
    );
  });

  it("兩次量測的成本都在 advisory 線之下 —— 警戒線不該天天在叫", () => {
    for (const name of ["a6-baseline.json", "a6b-baseline.json"]) {
      const report = evaluateGate(loadArtifact(name).metrics, BASELINE_THRESHOLDS);

      expect(report.advisoryFailures.map((check) => check.metricName)).not.toContain(
        "cost_per_case_usd",
      );
    }
  });

  it("門檻出處指向的 artifact 真的存在且與記錄相符", () => {
    const artifact = loadArtifact("a6b-baseline.json");

    expect(BASELINE_PROVENANCE.artifact).toBe("eval-artifacts/a6b-baseline.json");
    expect(artifact.datasetVersion).toBe(BASELINE_PROVENANCE.datasetVersion);
    expect(artifact.modelVersion).toBe(BASELINE_PROVENANCE.modelVersion);
    expect(artifact.caseCount).toBe(BASELINE_PROVENANCE.caseCount);
  });

  it("每一條門檻都寫了理由 —— 紅燈時要能自己解釋自己", () => {
    for (const threshold of BASELINE_THRESHOLDS) {
      expect(threshold.rationale.length).toBeGreaterThan(10);
    }
  });
});
