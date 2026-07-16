import { describe, it, expect } from "vitest";
import {
  orderMissingFields,
  canAskMoreClarifications,
  MAX_CLARIFICATION_ROUNDS,
} from "./clarificationFields.ts";

/**
 * 反問的 deterministic 核心：批次排序（FR-CL-1，一輪問完全部缺漏）與
 * 輪數上限（FR-CL-2）。這兩者不交給 LLM，必須可靠、可測。
 */

describe("orderMissingFields — 批次反問排序（一次列全部）", () => {
  it("空清單回空陣列", () => {
    expect(orderMissingFields([])).toEqual([]);
  });

  it("回傳全部缺漏欄位，不遺漏任何一項", () => {
    const result = orderMissingFields(["deadline_days", "subtype", "license_scope"]);
    expect(result).toHaveLength(3);
    expect(new Set(result)).toEqual(
      new Set(["deadline_days", "subtype", "license_scope"]),
    );
  });

  it("依優先序排列：subtype 影響基礎費率，排在授權/交期之前", () => {
    expect(orderMissingFields(["license_scope", "deadline_days", "subtype"])).toEqual([
      "subtype",
      "license_scope",
      "deadline_days",
    ]);
  });

  it("遵守 PRD 欄序：授權 > 交期", () => {
    expect(orderMissingFields(["deadline_days", "license_scope"])).toEqual([
      "license_scope",
      "deadline_days",
    ]);
  });

  it("優先序內的欄位排在未列出欄位之前，未列出者依原序穩定殿後", () => {
    expect(
      orderMissingFields(["feature_modules", "license_scope", "coloring_complexity"]),
    ).toEqual(["license_scope", "feature_modules", "coloring_complexity"]);
  });
});

describe("canAskMoreClarifications — 輪數上限", () => {
  it("未達上限時可繼續反問", () => {
    expect(canAskMoreClarifications(0)).toBe(true);
    expect(canAskMoreClarifications(MAX_CLARIFICATION_ROUNDS - 1)).toBe(true);
  });

  it("達到或超過上限時停止反問", () => {
    expect(canAskMoreClarifications(MAX_CLARIFICATION_ROUNDS)).toBe(false);
    expect(canAskMoreClarifications(MAX_CLARIFICATION_ROUNDS + 1)).toBe(false);
  });
});
