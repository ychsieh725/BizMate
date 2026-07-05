import { describe, it, expect } from "vitest";
import {
  selectNextField,
  canAskMoreClarifications,
  MAX_CLARIFICATION_ROUNDS,
} from "./clarificationFields.ts";

/**
 * 反問的 deterministic 核心：選欄優先序（FR-CL-1）與輪數上限（FR-CL-2）。
 * 這兩者不交給 LLM，必須可靠、可測。
 */

describe("selectNextField — 優先序選欄（每次一題）", () => {
  it("空清單回 null", () => {
    expect(selectNextField([])).toBeNull();
  });

  it("subtype 影響基礎費率，優先於授權/交期", () => {
    expect(selectNextField(["license_scope", "subtype"])).toBe("subtype");
  });

  it("遵守 PRD 三欄序：授權 > 交期 > 修改次數", () => {
    expect(selectNextField(["revision_count", "deadline_days", "license_scope"])).toBe(
      "license_scope",
    );
    expect(selectNextField(["revision_count", "deadline_days"])).toBe("deadline_days");
  });

  it("列在優先序內的欄位，優先於未列出的欄位", () => {
    expect(selectNextField(["feature_modules", "license_scope"])).toBe("license_scope");
  });

  it("全是未列出欄位時，回傳清單中第一個（穩定、依原序）", () => {
    expect(selectNextField(["coloring_complexity", "feature_modules"])).toBe(
      "coloring_complexity",
    );
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
