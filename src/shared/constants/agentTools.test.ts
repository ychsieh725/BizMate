/**
 * agent tool 標籤映射。
 *
 * 測的重點是**未知 tool 的退化行為**：這份對照表與 Python 端的 tool 註冊表
 * 是兩份各自維護的清單，新增 tool 時很容易只改一邊。此時正確的行為是顯示
 * 原始名稱（除錯時最有用的資訊），而不是顯示「未知」或讓畫面壞掉。
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_RUN_OUTCOME_LABELS,
  AGENT_STEP_STATUS_LABELS,
  agentToolLabel,
} from "./agentTools.ts";

describe("agentToolLabel", () => {
  it.each([
    ["lookup_rate_card", "查詢價目表"],
    ["record_fields", "記錄需求欄位"],
    ["ask_customer", "向客戶提問"],
    ["compute_quote", "計算報價"],
  ])("%s 有中文說明", (toolName, expected) => {
    expect(agentToolLabel(toolName)).toBe(expected);
  });

  it("未知 tool 退回原始名稱，讓除錯者仍能對回程式碼", () => {
    expect(agentToolLabel("some_new_tool")).toBe("some_new_tool");
  });

  it("空字串不會變成 undefined", () => {
    expect(agentToolLabel("")).toBe("");
  });
});

describe("狀態標籤", () => {
  it("四種 step 狀態都有標籤（對應 migration 0009 的 enum）", () => {
    expect(Object.keys(AGENT_STEP_STATUS_LABELS).sort()).toEqual([
      "error",
      "fallback",
      "ok",
      "rejected",
    ]);
  });

  it("rejected 的措辭不把護欄生效講成失敗", () => {
    expect(AGENT_STEP_STATUS_LABELS.rejected).toContain("重試");
    expect(AGENT_STEP_STATUS_LABELS.rejected).not.toContain("失敗");
  });

  it("三種 run 去向都有標籤", () => {
    expect(Object.keys(AGENT_RUN_OUTCOME_LABELS).sort()).toEqual([
      "completed",
      "error",
      "fallback",
    ]);
  });
});
