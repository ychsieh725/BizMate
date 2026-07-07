import { describe, it, expect } from "vitest";
import {
  createSessionBodySchema,
  describeBodySchema,
  RAW_TEXT_MAX_LENGTH,
  CONTACT_EMAIL_MAX_LENGTH,
} from "./sessionSchemas.ts";

/**
 * 系統邊界驗證的單元測試（coding-style「在系統邊界驗證」+ NFR-7 防超大 payload）。
 * 重點：raw_text 有上限，避免惡意超大輸入灌爆 Gemini token 與 DB。
 */

describe("createSessionBodySchema", () => {
  it("接受合法 category + slug", () => {
    expect(
      createSessionBodySchema.safeParse({ category: "graphic_design", slug: "dev" }).success,
    ).toBe(true);
  });

  it("拒絕未知 category", () => {
    expect(
      createSessionBodySchema.safeParse({ category: "unknown", slug: "dev" }).success,
    ).toBe(false);
  });

  it("拒絕缺 slug", () => {
    expect(
      createSessionBodySchema.safeParse({ category: "graphic_design" }).success,
    ).toBe(false);
  });

  it.each(["A", "-abc", "a b", "x", "a".repeat(33)])(
    "拒絕不合法 slug：%s",
    (slug) => {
      expect(
        createSessionBodySchema.safeParse({ category: "graphic_design", slug }).success,
      ).toBe(false);
    },
  );
});

describe("describeBodySchema — raw_text 邊界", () => {
  const validEmail = "a@b.com";

  it("接受長度在上限內的描述", () => {
    const result = describeBodySchema.safeParse({
      raw_text: "我要一張海報",
      contact_email: validEmail,
    });
    expect(result.success).toBe(true);
  });

  it("拒絕空描述", () => {
    expect(
      describeBodySchema.safeParse({ raw_text: "", contact_email: validEmail }).success,
    ).toBe(false);
  });

  it("接受剛好等於上限長度的描述", () => {
    const result = describeBodySchema.safeParse({
      raw_text: "字".repeat(RAW_TEXT_MAX_LENGTH),
      contact_email: validEmail,
    });
    expect(result.success).toBe(true);
  });

  it("拒絕超過上限長度的描述", () => {
    const result = describeBodySchema.safeParse({
      raw_text: "字".repeat(RAW_TEXT_MAX_LENGTH + 1),
      contact_email: validEmail,
    });
    expect(result.success).toBe(false);
  });
});

describe("describeBodySchema — contact_email 邊界", () => {
  it("拒絕格式錯誤的 email", () => {
    expect(
      describeBodySchema.safeParse({ raw_text: "x", contact_email: "not-email" }).success,
    ).toBe(false);
  });

  it("拒絕超過上限長度的 email", () => {
    const longLocal = "a".repeat(CONTACT_EMAIL_MAX_LENGTH);
    const result = describeBodySchema.safeParse({
      raw_text: "x",
      contact_email: `${longLocal}@b.com`,
    });
    expect(result.success).toBe(false);
  });
});
