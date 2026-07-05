import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession, submitDescribe, fetchStatus } from "./wizardApi.ts";

/**
 * wizardApi 是前端唯一碰 fetch 的地方——mock 全域 fetch 驗證：
 * 1. 正確的 method/url/body
 * 2. envelope 解封與 snake_case → camelCase 轉換
 * 3. 失敗（非 2xx / 網路錯誤 / 壞 JSON）都收斂成 ok:false，不 throw
 */

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

function mockFetchOnce(body: unknown, status = 200): void {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSession", () => {
  it("送出 category 並回傳 camelCase 的 sessionId/status", async () => {
    mockFetchOnce(
      {
        success: true,
        data: { session_id: SESSION_ID, status: "created" },
        error: null,
      },
      201,
    );

    const result = await createSession("graphic_design");

    expect(fetch).toHaveBeenCalledWith(
      "/api/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ category: "graphic_design" }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { sessionId: SESSION_ID, status: "created" },
    });
  });

  it("後端回錯誤 envelope 時收斂成 ok:false 帶 httpStatus", async () => {
    mockFetchOnce(
      { success: false, data: null, error: "category：不合法" },
      400,
    );

    const result = await createSession("graphic_design");

    expect(result).toEqual({
      ok: false,
      error: "category：不合法",
      httpStatus: 400,
    });
  });

  it("fetch 拋錯（網路失敗）時回傳友善錯誤而非 throw", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));

    const result = await createSession("illustration");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(0);
      expect(result.error).toMatch(/連線|網路/);
    }
  });
});

describe("submitDescribe", () => {
  it("送出 raw_text/contact_email 並轉換 quote_code 結果", async () => {
    mockFetchOnce({
      success: true,
      data: { status: "awaiting_freelancer", quote_code: "I-2607001" },
      error: null,
    });

    const result = await submitDescribe(SESSION_ID, {
      rawText: "我要一張海報",
      contactEmail: "a@b.com",
    });

    expect(fetch).toHaveBeenCalledWith(
      `/api/sessions/${SESSION_ID}/describe`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          raw_text: "我要一張海報",
          contact_email: "a@b.com",
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { status: "awaiting_freelancer", quoteCode: "I-2607001" },
    });
  });

  it("轉換 missing_fields（缺欄位）結果", async () => {
    mockFetchOnce({
      success: true,
      data: {
        status: "awaiting_clarification",
        missing_fields: ["budget", "deadline"],
      },
      error: null,
    });

    const result = await submitDescribe(SESSION_ID, {
      rawText: "隨便做做",
      contactEmail: "a@b.com",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        status: "awaiting_clarification",
        missingFields: ["budget", "deadline"],
      },
    });
  });

  it("轉換 out_of_scope 結果", async () => {
    mockFetchOnce({
      success: true,
      data: { status: "awaiting_freelancer", out_of_scope: true },
      error: null,
    });

    const result = await submitDescribe(SESSION_ID, {
      rawText: "我要蓋一棟大樓",
      contactEmail: "a@b.com",
    });

    expect(result).toEqual({
      ok: true,
      data: { status: "awaiting_freelancer", outOfScope: true },
    });
  });

  it("409（狀態不允許重送）收斂成 ok:false", async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        error: "session 目前狀態為 awaiting_freelancer，無法再次送出描述",
      },
      409,
    );

    const result = await submitDescribe(SESSION_ID, {
      rawText: "再送一次",
      contactEmail: "a@b.com",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(409);
  });
});

describe("fetchStatus", () => {
  it("回傳目前 status", async () => {
    mockFetchOnce({
      success: true,
      data: { status: "awaiting_freelancer" },
      error: null,
    });

    const result = await fetchStatus(SESSION_ID);

    expect(fetch).toHaveBeenCalledWith(
      `/api/sessions/${SESSION_ID}/status`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({
      ok: true,
      data: { status: "awaiting_freelancer" },
    });
  });

  it("404 收斂成 ok:false", async () => {
    mockFetchOnce(
      { success: false, data: null, error: "找不到指定的 session" },
      404,
    );

    const result = await fetchStatus(SESSION_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(404);
  });
});
