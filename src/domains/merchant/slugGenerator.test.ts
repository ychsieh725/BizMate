import { describe, it, expect, vi } from "vitest";
import {
  sanitizeEmailPrefix,
  slugBaseFromEmail,
  randomSlugBase,
  generateUniqueSlug,
  ADJECTIVES,
  NOUNS,
} from "./slugGenerator.ts";

describe("sanitizeEmailPrefix", () => {
  it("轉小寫並去除非英數字元", () => {
    expect(sanitizeEmailPrefix("Zhang.Wei+test@gmail.com")).toBe(
      "zhangweitest",
    );
  });

  it("中文字元全部去除，僅保留數字", () => {
    expect(sanitizeEmailPrefix("老板123@gmail.com")).toBe("123");
  });

  it("純中文前綴清洗後為空字串", () => {
    expect(sanitizeEmailPrefix("老板@gmail.com")).toBe("");
  });

  it("超長前綴截斷至 20 字元", () => {
    const longPrefix = "a".repeat(30);
    expect(sanitizeEmailPrefix(`${longPrefix}@gmail.com`)).toHaveLength(20);
  });
});

describe("slugBaseFromEmail", () => {
  it("清洗後長度足夠時直接採用", () => {
    expect(slugBaseFromEmail("abc123@gmail.com")).toBe("abc123");
  });

  it("清洗後長度恰為 3 時仍採用（不觸發 fallback）", () => {
    expect(slugBaseFromEmail("老板123@gmail.com")).toBe("123");
  });

  it("清洗後長度不足 3 時改用隨機詞組", () => {
    const random = () => 0;
    const result = slugBaseFromEmail("老板@gmail.com", random);
    expect(result).toBe(`${ADJECTIVES[0]}-${NOUNS[0]}-0000`);
  });
});

describe("randomSlugBase", () => {
  it("random 恆回 0 時取第一個形容詞/名詞 + 0000", () => {
    expect(randomSlugBase(() => 0)).toBe(`${ADJECTIVES[0]}-${NOUNS[0]}-0000`);
  });

  it("random 恆接近 1 時取最後一個形容詞/名詞", () => {
    const result = randomSlugBase(() => 0.9999);
    expect(result).toContain(ADJECTIVES[ADJECTIVES.length - 1]);
    expect(result).toContain(NOUNS[NOUNS.length - 1]);
  });
});

describe("generateUniqueSlug", () => {
  it("基底未被使用時直接回傳", async () => {
    const isTaken = vi.fn().mockResolvedValue(false);
    const result = await generateUniqueSlug("abc123@gmail.com", isTaken);
    expect(result).toBe("abc123");
    expect(isTaken).toHaveBeenCalledTimes(1);
  });

  it("基底碰撞時加數字後綴重試", async () => {
    const isTaken = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const result = await generateUniqueSlug(
      "abc123@gmail.com",
      isTaken,
      () => 0,
    );
    expect(result).toBe("abc123-000");
  });

  it("數字後綴 5 次都碰撞後改用完全隨機詞組", async () => {
    const isTaken = vi
      .fn()
      .mockResolvedValueOnce(true) // base
      .mockResolvedValueOnce(true) // suffix 1
      .mockResolvedValueOnce(true) // suffix 2
      .mockResolvedValueOnce(true) // suffix 3
      .mockResolvedValueOnce(true) // suffix 4
      .mockResolvedValueOnce(true) // suffix 5
      .mockResolvedValueOnce(false); // random fallback 1
    const result = await generateUniqueSlug(
      "abc123@gmail.com",
      isTaken,
      () => 0,
    );
    expect(result).toBe(`${ADJECTIVES[0]}-${NOUNS[0]}-0000`);
    expect(isTaken).toHaveBeenCalledTimes(7);
  });

  it("全部候選都碰撞時拋出例外", async () => {
    const isTaken = vi.fn().mockResolvedValue(true);
    await expect(
      generateUniqueSlug("abc123@gmail.com", isTaken, () => 0),
    ).rejects.toThrow("無法產生唯一 slug");
    expect(isTaken).toHaveBeenCalledTimes(11);
  });
});
