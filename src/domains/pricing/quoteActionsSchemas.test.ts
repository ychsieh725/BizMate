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

  // quotes.final_amount 是 NUMERIC(10,2)，上限 99,999,999.99。
  // 沒有上界的話，超大金額會在 Postgres 端溢位 → RepositoryError → 500，
  // 但那其實是輸入錯誤，該在邊界擋下並回 400。
  it("超過 NUMERIC(10,2) 上限失敗", () => {
    expect(
      adjustAmountBodySchema.safeParse({ final_amount: 99_999_999.99 }).success,
    ).toBe(true);
    expect(
      adjustAmountBodySchema.safeParse({ final_amount: 100_000_000 }).success,
    ).toBe(false);
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
