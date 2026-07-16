import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/domains/finops/costLogger.ts", () => ({
  generateStructuredAndLog: vi.fn(),
}));

import { generateStructuredAndLog } from "@/domains/finops/costLogger.ts";
import { generateClarificationQuestions } from "./clarificationAgent.ts";

const mockGenerate = vi.mocked(generateStructuredAndLog);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateClarificationQuestions（批次：一次問多欄）", () => {
  it("以 light tier 一次呼叫，prompt 含案件類型與各欄位中文標籤", async () => {
    mockGenerate.mockResolvedValue({
      data: {
        questions: ["這個作品會用在哪些用途上呢？", "希望什麼時候完成呢？"],
      },
    } as never);

    await generateClarificationQuestions({
      sessionId: "sid-1",
      category: "illustration",
      targetFields: ["license_scope", "deadline_days"],
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
    expect(args.prompt).toContain("授權範圍"); // 欄位中文標籤
    expect(args.prompt).toContain("交期天數");
  });

  it("questions 依索引與 targetFields 對齊（target_field 不交給 LLM）", async () => {
    mockGenerate.mockResolvedValue({
      data: {
        questions: ["用途問句", "交期問句"],
      },
    } as never);

    const result = await generateClarificationQuestions({
      sessionId: "sid-1",
      category: "graphic_design",
      targetFields: ["license_scope", "deadline_days"],
    });

    expect(result).toEqual([
      { targetField: "license_scope", question: "用途問句" },
      { targetField: "deadline_days", question: "交期問句" },
    ]);
  });

  it("LLM 回傳問句數量不足時，缺的以欄位標籤兜底", async () => {
    mockGenerate.mockResolvedValue({
      data: { questions: ["用途問句"] }, // 只回一句，但問了兩欄
    } as never);

    const result = await generateClarificationQuestions({
      sessionId: "sid-1",
      category: "graphic_design",
      targetFields: ["license_scope", "deadline_days"],
    });

    expect(result[0]).toEqual({ targetField: "license_scope", question: "用途問句" });
    expect(result[1]!.targetField).toBe("deadline_days");
    expect(result[1]!.question).toContain("交期天數"); // 兜底問句含標籤
  });

  it("targetFields 為空時不呼叫 LLM、回空陣列", async () => {
    const result = await generateClarificationQuestions({
      sessionId: "sid-1",
      category: "illustration",
      targetFields: [],
    });

    expect(result).toEqual([]);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
