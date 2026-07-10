import { describe, it, expect } from "vitest";
import {
  createServiceBodySchema,
  updateServiceBodySchema,
  serviceIdSchema,
} from "./servicesSchemas.ts";

describe("createServiceBodySchema", () => {
  it("合法 body 通過", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 6000,
      includes: "3款初稿",
    });
    expect(result.success).toBe(true);
  });

  it("category 不在列舉值 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "not_a_category",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 6000,
    });
    expect(result.success).toBe(false);
  });

  it("subtype 空字串 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "",
      unit: "每角色",
      base_price: 6000,
    });
    expect(result.success).toBe(false);
  });

  it("unit 空字串 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "",
      base_price: 6000,
    });
    expect(result.success).toBe(false);
  });

  it("base_price 缺漏 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
    });
    expect(result.success).toBe(false);
  });

  it("base_price 為 0 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 0,
    });
    expect(result.success).toBe(false);
  });

  it("base_price 為負數 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: -100,
    });
    expect(result.success).toBe(false);
  });

  it("includes 缺漏（選填）→ 通過", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 6000,
    });
    expect(result.success).toBe(true);
  });

  it("includes 為 null → 通過", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 6000,
      includes: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateServiceBodySchema", () => {
  it("僅 base_price → 通過", () => {
    const result = updateServiceBodySchema.safeParse({ base_price: 7000 });
    expect(result.success).toBe(true);
  });

  it("空物件（全部省略）→ 通過", () => {
    const result = updateServiceBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("base_price 為負數 → 失敗", () => {
    const result = updateServiceBodySchema.safeParse({ base_price: -1 });
    expect(result.success).toBe(false);
  });

  it("unit 空字串 → 失敗", () => {
    const result = updateServiceBodySchema.safeParse({ unit: "" });
    expect(result.success).toBe(false);
  });
});

describe("serviceIdSchema", () => {
  it("合法 UUID → 通過", () => {
    expect(
      serviceIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000")
        .success,
    ).toBe(true);
  });

  it("非 UUID → 失敗", () => {
    expect(serviceIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
