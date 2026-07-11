import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "./errors.ts";

describe("isUniqueViolation", () => {
  it("訊息含 'duplicate key' → true", () => {
    expect(isUniqueViolation(new Error("duplicate key value violates unique constraint"))).toBe(true);
  });

  it("訊息含 '23505' → true", () => {
    expect(isUniqueViolation(new Error("23505: unique_violation"))).toBe(true);
  });

  it("其他錯誤訊息 → false", () => {
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
  });

  it("非 Error 物件 → false", () => {
    expect(isUniqueViolation("not an error")).toBe(false);
  });
});
