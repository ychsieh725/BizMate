import { describe, it, expect } from "vitest";
import { adjustAmountBodySchema } from "./quoteActionsSchemas.ts";

describe("adjustAmountBodySchema", () => {
  it("正數金額通過", () => {
    const result = adjustAmountBodySchema.safeParse({ final_amount: 9000 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.final_amount).toBe(9000);
    }
  });

  it("零或負數失敗", () => {
    expect(adjustAmountBodySchema.safeParse({ final_amount: 0 }).success).toBe(false);
    expect(adjustAmountBodySchema.safeParse({ final_amount: -100 }).success).toBe(false);
  });

  it("缺欄位失敗", () => {
    expect(adjustAmountBodySchema.safeParse({}).success).toBe(false);
  });

  it("字串金額失敗（不做隱式轉型）", () => {
    expect(adjustAmountBodySchema.safeParse({ final_amount: "9000" }).success).toBe(
      false,
    );
  });
});
