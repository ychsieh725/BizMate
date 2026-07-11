import { describe, it, expect } from "vitest";
import { listQuotesQuerySchema, quoteIdSchema } from "./quoteReviewSchemas.ts";

describe("quoteIdSchema", () => {
  it("合法 UUID 通過", () => {
    const result = quoteIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000");
    expect(result.success).toBe(true);
  });

  it("非 UUID 字串失敗", () => {
    expect(quoteIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("listQuotesQuerySchema", () => {
  it("無 status（空物件）通過，status 為 undefined", () => {
    const result = listQuotesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBeUndefined();
    }
  });

  it("合法 status 通過", () => {
    const result = listQuotesQuerySchema.safeParse({ status: "awaiting_review" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("awaiting_review");
    }
  });

  it("非法 status 失敗", () => {
    expect(listQuotesQuerySchema.safeParse({ status: "pending" }).success).toBe(false);
  });
});
