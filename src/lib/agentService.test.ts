import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { callAgentService } from "@/lib/agentService.ts";

/**
 * agent-service HTTP client 的測試。
 *
 * 核心約束來自設計文件的不變式 I-3「agent 失控必須退回現行路徑」：
 * 這個 client **永遠不得拋例外**，任何失敗都要轉成帶 reason 的結果，
 * 讓 orchestrator 能據以 fallback。若它會拋，route 就會回 500，
 * 使用者看到的是錯誤而非降級後的正常流程——那等於 I-3 失效。
 */

const ORIGINAL_FETCH = globalThis.fetch;

/**
 * 建立一個回傳指定狀態與主體的假 fetch。
 * 明確標註 fetch 的參數簽名，測試才能型別安全地檢查呼叫時傳了什麼。
 */
function stubFetch(status: number, body: unknown) {
  return vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

beforeEach(() => {
  vi.stubEnv("AGENT_SERVICE_URL", "https://agent.test");
  vi.stubEnv("INTERNAL_SERVICE_SECRET", "a-sufficiently-long-secret");
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("callAgentService — 成功路徑", () => {
  it("回傳信封中的 data", async () => {
    globalThis.fetch = stubFetch(200, {
      success: true,
      data: { echo: "hi" },
      error: null,
    });

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result).toEqual({ ok: true, data: { echo: "hi" } });
  });

  it("帶上內部認證標頭", async () => {
    const fetchSpy = stubFetch(200, { success: true, data: {}, error: null });
    globalThis.fetch = fetchSpy;

    await callAgentService("/agent/echo", { message: "hi" });

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["x-internal-secret"]).toBe("a-sufficiently-long-secret");
  });

  it("組出正確的目標 URL", async () => {
    const fetchSpy = stubFetch(200, { success: true, data: {}, error: null });
    globalThis.fetch = fetchSpy;

    await callAgentService("/agent/echo", { message: "hi" });

    expect(fetchSpy.mock.calls[0][0]).toBe("https://agent.test/agent/echo");
  });
});

describe("callAgentService — 失敗一律轉為結果，不拋例外（I-3）", () => {
  it("401 → unauthorized", async () => {
    globalThis.fetch = stubFetch(401, {
      success: false,
      data: null,
      error: "內部服務認證失敗",
    });

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unauthorized");
  });

  it("500 → service_error", async () => {
    globalThis.fetch = stubFetch(500, {
      success: false,
      data: null,
      error: "boom",
    });

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("service_error");
  });

  it("連線失敗 → unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreachable");
  });

  it("逾時 → timeout", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });

  it("回應非 JSON → invalid_response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("<html>502 Bad Gateway</html>", { status: 200 }),
    );

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_response");
  });

  it("回應缺少信封欄位 → invalid_response", async () => {
    globalThis.fetch = stubFetch(200, { unexpected: "shape" });

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_response");
  });

  it("200 但信封標記失敗 → service_error", async () => {
    globalThis.fetch = stubFetch(200, {
      success: false,
      data: null,
      error: "內部錯誤",
    });

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("service_error");
  });

  it("未設定服務位址 → not_configured（而非拋例外）", async () => {
    vi.stubEnv("AGENT_SERVICE_URL", "");
    globalThis.fetch = stubFetch(200, { success: true, data: {}, error: null });

    const result = await callAgentService("/agent/echo", { message: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
  });
});

describe("callAgentService — 不重試", () => {
  it("失敗時只呼叫一次，直接讓上層 fallback", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    globalThis.fetch = fetchSpy;

    await callAgentService("/agent/echo", { message: "hi" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
