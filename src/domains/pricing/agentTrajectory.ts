/**
 * 決策軌跡的分組與摘要（A7）。
 *
 * ## 為什麼需要分組
 *
 * 一個 session 會跑不只一次 agent loop：describe 一次，之後每輪 answer 各一次。
 * `agent_steps` 是扁平的一張表，直接依時間列出來，後台會看到「第 1 步、第 2 步、
 * 第 3 步、第 1 步、第 2 步…」這種讀不懂的序列，而且看不出它其實跑了兩趟。
 *
 * 分組鍵是 `run_id`，這正是 migration 0009 為此建立 `(run_id, step_index)`
 * 索引與唯一約束的理由。
 *
 * ## 純函式的理由
 *
 * 這裡不碰資料庫也不碰 React，才能用假資料把排序與判定規則完整測過。
 * 軌跡判讀規則寫錯不會有任何執行期錯誤，只會讓後台長期顯示錯誤的結論。
 */
import type { Tables } from "@/lib/supabase/database.types.ts";

export type AgentStep = Tables<"agent_steps">;

/** 一次完整的 agent loop 執行。 */
export interface AgentRun {
  readonly runId: string;
  /** 這是該 session 的第幾趟 loop，從 1 起算。供 UI 顯示「第 2 次執行」。 */
  readonly attempt: number;
  /** 已依 step_index 遞增排序。 */
  readonly steps: readonly AgentStep[];
  /** 各步延遲加總；未記錄延遲的步驟以 0 計。 */
  readonly totalLatencyMs: number;
  readonly startedAt: string;
}

/**
 * 一次 loop 的最終去向。
 *
 * 刻意不叫 status，避免與單一 step 的 status 混淆：step 講的是「這一步發生
 * 什麼」，這裡講的是「這一趟最後去了哪裡」。
 */
export type AgentRunOutcome = "completed" | "fallback" | "error";

/** 把扁平的 step 陣列整理成依時間排序的多趟執行。 */
export function groupStepsIntoRuns(steps: readonly AgentStep[]): AgentRun[] {
  const byRun = new Map<string, AgentStep[]>();
  for (const step of steps) {
    const bucket = byRun.get(step.run_id);
    if (bucket === undefined) {
      byRun.set(step.run_id, [step]);
      continue;
    }
    bucket.push(step);
  }

  const runs = [...byRun.entries()].map(([runId, bucket]) => {
    // 不依賴查詢的回傳順序：排序規則屬於這裡的職責，放到 SQL 就變成
    // 「改了 order by 才發現 UI 壞掉」的隱性耦合。
    const ordered = [...bucket].sort((a, b) => a.step_index - b.step_index);
    return {
      runId,
      steps: ordered,
      totalLatencyMs: ordered.reduce((sum, step) => sum + (step.latency_ms ?? 0), 0),
      startedAt: ordered.reduce(
        (earliest, step) => (step.created_at < earliest ? step.created_at : earliest),
        ordered[0].created_at,
      ),
    };
  });

  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  return runs.map((run, index) => ({ ...run, attempt: index + 1 }));
}

/**
 * 判定一趟 loop 的去向。
 *
 * 判定順序是有意義的：**fallback 優先於 error**。一趟 loop 可能先撞到 error
 * 再交棒，此時使用者該知道的是「最後退回既有流程」，而不是中間那個已被處理
 * 掉的錯誤。
 *
 * `rejected` 不列入判定。那是 tool 層護欄擋下不合規參數、agent 隨後自行修正
 * 的正常現象（A6 的 web-007 即為實例），把它算成失敗會讓護欄生效看起來像故障。
 */
export function runOutcome(run: AgentRun): AgentRunOutcome {
  if (run.steps.some((step) => step.status === "fallback")) {
    return "fallback";
  }
  if (run.steps.some((step) => step.status === "error")) {
    return "error";
  }
  return "completed";
}
