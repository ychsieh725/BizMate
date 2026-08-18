/**
 * 決策軌跡的分組與摘要（A7）。
 *
 * 這一層要解決的是一個容易被忽略的事實：**一個 session 會跑不只一次 agent
 * loop**。describe 一次，之後每輪 answer 各一次。若把 agent_steps 當成一條
 * 連續軌跡直接列出來，後台會看到「第 1 步、第 2 步、第 3 步、第 1 步、第 2
 * 步…」這種讀不懂的序列，而且完全看不出它其實跑了兩趟。
 *
 * 分組依據是 run_id，這正是 migration 0009 為此建立 (run_id, step_index)
 * 索引與唯一約束的理由。
 */
import { describe, expect, it } from "vitest";

import type { Tables } from "@/lib/supabase/database.types.ts";
import { groupStepsIntoRuns, runOutcome } from "./agentTrajectory.ts";

type Step = Tables<"agent_steps">;

function step(overrides: Partial<Step> = {}): Step {
  return {
    id: crypto.randomUUID(),
    session_id: "session-1",
    run_id: "run-a",
    step_index: 0,
    tool_name: "lookup_rate_card",
    tool_args: null,
    tool_result: null,
    status: "ok",
    error_detail: null,
    cost_log_id: null,
    latency_ms: 300,
    created_at: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("groupStepsIntoRuns", () => {
  it("無軌跡時回空陣列，而非拋錯", () => {
    expect(groupStepsIntoRuns([])).toEqual([]);
  });

  it("依 run_id 分組，一個 session 的多次 loop 不會被串成一條", () => {
    const runs = groupStepsIntoRuns([
      step({ run_id: "run-a", step_index: 0 }),
      step({ run_id: "run-a", step_index: 1 }),
      step({ run_id: "run-b", step_index: 0 }),
    ]);

    expect(runs).toHaveLength(2);
    expect(runs[0].steps).toHaveLength(2);
    expect(runs[1].steps).toHaveLength(1);
  });

  it("run 依最早的 step 時間排序，先跑的在前", () => {
    const runs = groupStepsIntoRuns([
      step({ run_id: "later", created_at: "2026-08-18T00:05:00.000Z" }),
      step({ run_id: "earlier", created_at: "2026-08-18T00:01:00.000Z" }),
    ]);

    expect(runs.map((run) => run.runId)).toEqual(["earlier", "later"]);
  });

  it("run 內部依 step_index 排序，不依賴查詢回傳順序", () => {
    const runs = groupStepsIntoRuns([
      step({ step_index: 2, tool_name: "compute_quote" }),
      step({ step_index: 0, tool_name: "lookup_rate_card" }),
      step({ step_index: 1, tool_name: "record_fields" }),
    ]);

    expect(runs[0].steps.map((item) => item.tool_name)).toEqual([
      "lookup_rate_card",
      "record_fields",
      "compute_quote",
    ]);
  });

  it("每個 run 標上第幾趟，供 UI 顯示「第 2 次執行」", () => {
    const runs = groupStepsIntoRuns([
      step({ run_id: "a", created_at: "2026-08-18T00:01:00.000Z" }),
      step({ run_id: "b", created_at: "2026-08-18T00:02:00.000Z" }),
    ]);

    expect(runs.map((run) => run.attempt)).toEqual([1, 2]);
  });

  it("累加延遲，null 視為 0 而不讓整筆變成 null", () => {
    const runs = groupStepsIntoRuns([
      step({ step_index: 0, latency_ms: 300 }),
      step({ step_index: 1, latency_ms: null }),
      step({ step_index: 2, latency_ms: 1200 }),
    ]);

    expect(runs[0].totalLatencyMs).toBe(1500);
  });
});

describe("runOutcome", () => {
  it("最後一步是 ok 即視為正常完成", () => {
    const [run] = groupStepsIntoRuns([
      step({ step_index: 0, tool_name: "lookup_rate_card" }),
      step({ step_index: 1, tool_name: "compute_quote", status: "ok" }),
    ]);

    expect(runOutcome(run)).toBe("completed");
  });

  it("出現 fallback 步即視為交棒，即使前面幾步都成功", () => {
    const [run] = groupStepsIntoRuns([
      step({ step_index: 0, status: "ok" }),
      step({ step_index: 1, status: "fallback" }),
    ]);

    expect(runOutcome(run)).toBe("fallback");
  });

  it("被拒絕的步驟不算失敗 —— 那是護欄生效後 agent 自行修正", () => {
    const [run] = groupStepsIntoRuns([
      step({ step_index: 0, status: "rejected" }),
      step({ step_index: 1, status: "ok" }),
    ]);

    expect(runOutcome(run)).toBe("completed");
  });

  it("error 步驟即視為錯誤", () => {
    const [run] = groupStepsIntoRuns([
      step({ step_index: 0, status: "ok" }),
      step({ step_index: 1, status: "error" }),
    ]);

    expect(runOutcome(run)).toBe("error");
  });

  it("同時有 error 與 fallback 時以 fallback 為準 —— 那是這次 loop 的最終去向", () => {
    const [run] = groupStepsIntoRuns([
      step({ step_index: 0, status: "error" }),
      step({ step_index: 1, status: "fallback" }),
    ]);

    expect(runOutcome(run)).toBe("fallback");
  });
});
