import { describe, it, expect, vi, beforeEach } from "vitest";
import { getClientIp, windowStartFor, checkRateLimit } from "./rateLimit.ts";

/**
 * 限流的三個關注點：
 * 1. IP 取值（x-forwarded-for，Vercel 代理標頭）
 * 2. 固定視窗對齊
 * 3. RPC 結果對映 + fail-open（限流層故障不應讓全站不可用）
 */

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/client.ts", () => ({
  getSupabaseClient: () => ({ rpc: rpcMock }),
}));

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getClientIp", () => {
  it("取 x-forwarded-for 的第一段", () => {
    const request = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(request)).toBe("1.2.3.4");
  });

  it("無標頭時回 unknown", () => {
    expect(getClientIp(new Request("http://x"))).toBe("unknown");
  });
});

describe("windowStartFor", () => {
  it("將時間對齊到視窗起點（floor）", () => {
    const hourMs = 3_600_000;
    // 01:30:00 → 對齊到 01:00:00
    const now = Date.parse("2026-07-05T01:30:00.000Z");
    expect(windowStartFor(now, hourMs).toISOString()).toBe("2026-07-05T01:00:00.000Z");
  });
});

describe("checkRateLimit", () => {
  const rule = { limit: 10, windowMs: 3_600_000 };
  const now = Date.parse("2026-07-05T01:30:00.000Z");

  it("RPC 回 true 時允許，並以對齊後視窗與參數呼叫 RPC", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });

    const result = await checkRateLimit("sessions:1.2.3.4", rule, now);

    expect(result).toEqual({ allowed: true });
    expect(rpcMock).toHaveBeenCalledWith("increment_rate_limit", {
      p_bucket_key: "sessions:1.2.3.4",
      p_window_start: "2026-07-05T01:00:00.000Z",
      p_limit: 10,
    });
  });

  it("RPC 回 false 時拒絕", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const result = await checkRateLimit("sessions:1.2.3.4", rule, now);
    expect(result).toEqual({ allowed: false });
  });

  it("RPC 回 error 時 fail-open 放行", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await checkRateLimit("sessions:1.2.3.4", rule, now);
    expect(result).toEqual({ allowed: true });
  });

  it("RPC 拋例外時 fail-open 放行", async () => {
    rpcMock.mockRejectedValueOnce(new Error("network"));
    const result = await checkRateLimit("sessions:1.2.3.4", rule, now);
    expect(result).toEqual({ allowed: true });
  });
});
