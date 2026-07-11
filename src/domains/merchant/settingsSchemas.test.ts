import { describe, it, expect } from "vitest";
import { updateSettingsBodySchema } from "./settingsSchemas.ts";

describe("updateSettingsBodySchema", () => {
  it("合法 display_name + public_slug → 通過", () => {
    const result = updateSettingsBodySchema.safeParse({
      display_name: "王小明工作室",
      public_slug: "wang-studio",
    });
    expect(result.success).toBe(true);
  });

  it("只帶 display_name → 通過（部分更新）", () => {
    const result = updateSettingsBodySchema.safeParse({
      display_name: "新名稱",
    });
    expect(result.success).toBe(true);
  });

  it("只帶 public_slug → 通過（部分更新）", () => {
    const result = updateSettingsBodySchema.safeParse({
      public_slug: "new-slug",
    });
    expect(result.success).toBe(true);
  });

  it("空物件 → 失敗（至少一欄）", () => {
    const result = updateSettingsBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("public_slug 含大寫 → 失敗", () => {
    const result = updateSettingsBodySchema.safeParse({ public_slug: "Wang-Studio" });
    expect(result.success).toBe(false);
  });

  it("public_slug 含底線 → 失敗", () => {
    const result = updateSettingsBodySchema.safeParse({ public_slug: "wang_studio" });
    expect(result.success).toBe(false);
  });

  it("public_slug 太短（<3 字元）→ 失敗", () => {
    const result = updateSettingsBodySchema.safeParse({ public_slug: "ab" });
    expect(result.success).toBe(false);
  });

  it("public_slug 太長（>32 字元）→ 失敗", () => {
    const result = updateSettingsBodySchema.safeParse({
      public_slug: "a".repeat(33),
    });
    expect(result.success).toBe(false);
  });

  it("display_name 空字串 → 失敗", () => {
    const result = updateSettingsBodySchema.safeParse({ display_name: "" });
    expect(result.success).toBe(false);
  });
});
