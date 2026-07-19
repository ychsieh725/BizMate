import { describe, it, expect } from "vitest";
import { isStepFilled } from "./StepProgress.tsx";

/**
 * StepProgress 的填色判斷（純函式，抽出以利獨立測試，同 dashboard/StatusPill 慣例）。
 * 規則：小於等於目前步驟的點都視為「已填」（含目前步驟本身），之後的點未填。
 */
describe("isStepFilled", () => {
  it("目前步驟本身視為已填", () => {
    expect(isStepFilled(2, 2)).toBe(true);
  });

  it("已完成的步驟視為已填", () => {
    expect(isStepFilled(1, 3)).toBe(true);
  });

  it("尚未到達的步驟視為未填", () => {
    expect(isStepFilled(3, 1)).toBe(false);
  });

  it("第一步時只有第一點已填", () => {
    expect(isStepFilled(1, 1)).toBe(true);
    expect(isStepFilled(2, 1)).toBe(false);
  });

  it("最後一步時全部已填", () => {
    expect(isStepFilled(1, 4)).toBe(true);
    expect(isStepFilled(4, 4)).toBe(true);
  });
});
