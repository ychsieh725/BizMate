import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CaseCategory } from "@/shared/types/domain.types";

vi.mock("@/domains/finops/costLogger.ts", () => ({
  generateStructuredAndLog: vi.fn(),
}));

import { generateStructuredAndLog } from "@/domains/finops/costLogger.ts";
import { parseIntake, isFieldMissing } from "@/domains/intake/parserAgent.ts";
import {
  requiredFieldsFor,
  CONFIDENCE_THRESHOLD,
  type FieldExtraction,
} from "@/domains/intake/parserFields.ts";

const mockGenerate = vi.mocked(generateStructuredAndLog);

/** 造一份指定 category 的「齊全」抽取結果（每欄高 confidence、有值）。 */
function fullFields(
  category: CaseCategory,
  overrides: Record<string, FieldExtraction> = {},
): Record<string, FieldExtraction> {
  const fields: Record<string, FieldExtraction> = {};
  for (const name of requiredFieldsFor(category)) {
    fields[name] = { value: `${name}值`, confidence: 0.9, source_span: "原文片段" };
  }
  return { ...fields, ...overrides };
}

/** 讓 mock 回傳指定 fields，包成 generateStructuredAndLog 的結果形狀。 */
function mockReturns(fields: Record<string, FieldExtraction>): void {
  mockGenerate.mockResolvedValue({
    data: { fields },
    model: "gemini-3.1-flash-lite",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    latencyMs: 100,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isFieldMissing", () => {
  it("欄位不存在 → 缺漏", () => {
    expect(isFieldMissing(undefined)).toBe(true);
  });
  it("value 為 null → 缺漏", () => {
    expect(isFieldMissing({ value: null, confidence: 0.9, source_span: null })).toBe(true);
  });
  it("value 為空白字串 → 缺漏", () => {
    expect(isFieldMissing({ value: "  ", confidence: 0.9, source_span: null })).toBe(true);
  });
  it("confidence 低於門檻 → 缺漏", () => {
    expect(
      isFieldMissing({ value: "x", confidence: CONFIDENCE_THRESHOLD - 0.01, source_span: "x" }),
    ).toBe(true);
  });
  it("有值且 confidence 達門檻 → 不缺漏", () => {
    expect(
      isFieldMissing({ value: "x", confidence: CONFIDENCE_THRESHOLD, source_span: "x" }),
    ).toBe(false);
  });
});

/** 測試用的 subtype 值域（模擬某商家 rate card 的在售項目）。 */
const SUBTYPES = ["LOGO設計", "海報文宣"];

describe("parseIntake", () => {
  it("欄位齊全 → missingRequiredFields 為空", async () => {
    mockReturns(fullFields("illustration"));

    const result = await parseIntake({
      sessionId: "s1",
      category: "illustration",
      rawText: "幫我畫一個角色，商用，三天內",
      allowedSubtypes: SUBTYPES,
    });

    expect(result.missingRequiredFields).toEqual([]);
  });

  it("某欄 value 為 null → 列入缺漏", async () => {
    mockReturns(
      fullFields("illustration", {
        deadline_days: { value: null, confidence: 0, source_span: null },
      }),
    );

    const result = await parseIntake({
      sessionId: "s1",
      category: "illustration",
      rawText: "幫我畫一個角色",
      allowedSubtypes: SUBTYPES,
    });

    expect(result.missingRequiredFields).toContain("deadline_days");
  });

  it("某欄低 confidence → 列入缺漏", async () => {
    mockReturns(
      fullFields("graphic_design", {
        subtype: { value: "LOGO設計", confidence: 0.3, source_span: "logo" },
      }),
    );

    const result = await parseIntake({
      sessionId: "s1",
      category: "graphic_design",
      rawText: "想要一個 logo",
      allowedSubtypes: SUBTYPES,
    });

    expect(result.missingRequiredFields).toContain("subtype");
  });

  it("依 category 切換必要欄位（web_design 檢查 page_count，graphic 不檢查）", async () => {
    // 只回傳空 fields，讓所有必要欄位都算缺漏，藉此觀察「檢查了哪些欄位」
    mockReturns({});

    const web = await parseIntake({
      sessionId: "s",
      category: "web_design",
      rawText: "x",
      allowedSubtypes: SUBTYPES,
    });
    expect(web.missingRequiredFields).toContain("page_count");
    expect(web.missingRequiredFields).toContain("includes_cms");

    const graphic = await parseIntake({
      sessionId: "s",
      category: "graphic_design",
      rawText: "x",
      allowedSubtypes: SUBTYPES,
    });
    expect(graphic.missingRequiredFields).not.toContain("page_count");
    expect(graphic.missingRequiredFields).toContain("includes_pitch_rounds");
  });

  it("以 light tier、intake_parser 名稱呼叫，並帶入 sessionId 與 raw_text", async () => {
    mockReturns(fullFields("graphic_design"));

    await parseIntake({
      sessionId: "sess-42",
      category: "graphic_design",
      rawText: "設計一個海報",
      allowedSubtypes: SUBTYPES,
    });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const arg = mockGenerate.mock.calls[0][0];
    expect(arg.tier).toBe("light");
    expect(arg.agentName).toBe("intake_parser");
    expect(arg.sessionId).toBe("sess-42");
    expect(arg.prompt).toContain("設計一個海報");
    expect(arg.systemInstruction).toBeTruthy();
  });

  // ── WBS 6.8：subtype 值域約束 ──

  it("可選 subtype 寫進 prompt，讓模型知道有哪些選項可歸類", async () => {
    mockReturns(fullFields("graphic_design"));

    await parseIntake({
      sessionId: "s1",
      category: "graphic_design",
      rawText: "想要一個 logo",
      allowedSubtypes: SUBTYPES,
    });

    const prompt = mockGenerate.mock.calls[0][0].prompt;
    expect(prompt).toContain("LOGO設計");
    expect(prompt).toContain("海報文宣");
  });

  it("subtype 清單為空時 prompt 不出現選項提示（新商家尚無服務項目）", async () => {
    mockReturns(fullFields("graphic_design"));

    await parseIntake({
      sessionId: "s1",
      category: "graphic_design",
      rawText: "想要一個 logo",
      allowedSubtypes: [],
    });

    expect(mockGenerate.mock.calls[0][0].prompt).not.toContain("只能從以下服務項目");
  });

  it("system instruction 明確禁止勉強歸類，避免 enum 逼出錯配", async () => {
    mockReturns(fullFields("graphic_design"));

    await parseIntake({
      sessionId: "s1",
      category: "graphic_design",
      rawText: "x",
      allowedSubtypes: SUBTYPES,
    });

    expect(mockGenerate.mock.calls[0][0].systemInstruction).toContain(
      "不得勉強歸類",
    );
  });
});
