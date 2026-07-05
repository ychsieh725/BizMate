import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/domains/finops/costLogger.ts", () => ({
  generateStructuredAndLog: vi.fn(),
}));

import { generateStructuredAndLog } from "@/domains/finops/costLogger.ts";
import { generateClarificationQuestion } from "./clarificationAgent.ts";

const mockGenerate = vi.mocked(generateStructuredAndLog);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateClarificationQuestion", () => {
  it("以 light tier 呼叫，prompt 含案件類型與欄位中文標籤", async () => {
    mockGenerate.mockResolvedValue({
      data: { question: "這個案子預計可以接受幾次修改呢？" },
    } as never);

    await generateClarificationQuestion({
      sessionId: "sid-1",
      category: "illustration",
      targetField: "revision_count",
    });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const args = mockGenerate.mock.calls[0]![0] as {
      tier: string;
      agentName: string;
      sessionId: string;
      prompt: string;
    };
    expect(args.tier).toBe("light");
    expect(args.agentName).toBe("clarification");
    expect(args.sessionId).toBe("sid-1");
    expect(args.prompt).toContain("插畫"); // 案件類型中文
    expect(args.prompt).toContain("修改次數"); // 欄位中文標籤
  });

  it("target_field 由程式端原樣回傳（不由 LLM 決定，保證 ∈ 缺漏清單）", async () => {
    mockGenerate.mockResolvedValue({
      data: { question: "這個作品會用在哪些用途上呢？" },
    } as never);

    const result = await generateClarificationQuestion({
      sessionId: "sid-1",
      category: "graphic_design",
      targetField: "license_scope",
    });

    expect(result).toEqual({
      question: "這個作品會用在哪些用途上呢？",
      targetField: "license_scope",
    });
  });
});
