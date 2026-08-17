import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { isInternalRequestAuthorized } from "@/lib/api/internalAuth.ts";

/**
 * 內部服務端點的認證。
 *
 * 設計文件〈安全考量〉v3 的核心提醒：Python 與 Next.js 共用 domain
 * **不代表這些端點受保護**——`/api/internal/**` 仍可被外部直接請求。
 * shared secret 是唯一防線，不因同域而省略。
 */

const SECRET = "a-sufficiently-long-secret";

function requestWith(secret: string | null): Request {
  return new Request("http://localhost/api/internal/pricing/compute", {
    method: "POST",
    headers: secret === null ? {} : { "x-internal-secret": secret },
  });
}

beforeEach(() => {
  vi.stubEnv("INTERNAL_SERVICE_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isInternalRequestAuthorized", () => {
  it("secret 正確 → 放行", () => {
    expect(isInternalRequestAuthorized(requestWith(SECRET))).toBe(true);
  });

  it("未帶 secret → 拒絕", () => {
    expect(isInternalRequestAuthorized(requestWith(null))).toBe(false);
  });

  it("secret 錯誤 → 拒絕", () => {
    expect(isInternalRequestAuthorized(requestWith("wrong-value"))).toBe(false);
  });

  it("正確值的前綴不得通過", () => {
    expect(isInternalRequestAuthorized(requestWith(SECRET.slice(0, -1)))).toBe(
      false,
    );
  });

  it("長度不同不得通過（且不拋例外）", () => {
    expect(isInternalRequestAuthorized(requestWith("x"))).toBe(false);
  });

  it("空字串不得通過", () => {
    expect(isInternalRequestAuthorized(requestWith(""))).toBe(false);
  });

  it("未設定 INTERNAL_SERVICE_SECRET → 一律拒絕（fail closed）", () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "");

    expect(isInternalRequestAuthorized(requestWith(SECRET))).toBe(false);
  });
});
