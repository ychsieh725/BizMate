import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/domains/intake/sessionService.ts", () => ({
  createSession: vi.fn(),
  getSessionStatus: vi.fn(),
}));

import { getSessionStatus } from "@/domains/intake/sessionService.ts";
import { GET } from "@/app/api/sessions/[id]/status/route.ts";

const mockGetStatus = vi.mocked(getSessionStatus);
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

function getWith(id: string) {
  return GET(new Request(`http://localhost/api/sessions/${id}/status`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/sessions/{id}/status", () => {
  it("存在的 session → 200 + status", async () => {
    mockGetStatus.mockResolvedValue("awaiting_review");

    const res = await getWith(VALID_UUID);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      data: { status: "awaiting_review" },
      error: null,
    });
    expect(mockGetStatus).toHaveBeenCalledWith(VALID_UUID);
  });

  it("非法 UUID → 400（不查 DB）", async () => {
    const res = await getWith("not-a-uuid");
    expect(res.status).toBe(400);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it("查無 session → 404", async () => {
    mockGetStatus.mockResolvedValue(null);

    const res = await getWith(VALID_UUID);
    expect(res.status).toBe(404);
  });

  it("service 拋錯 → 500 + 友善訊息", async () => {
    mockGetStatus.mockRejectedValue(new Error("timeout"));

    const res = await getWith(VALID_UUID);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).not.toContain("timeout");
  });
});
