import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/serverClient.ts", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@/domains/merchant/onboardMerchant.ts", () => ({
  onboardMerchant: vi.fn(),
}));

import { onboardMerchant } from "@/domains/merchant/onboardMerchant.ts";
import { POST } from "./route.ts";

const mockOnboardMerchant = vi.mocked(onboardMerchant);

const MERCHANT: Tables<"merchants"> = {
  id: "99999999-9999-9999-9999-999999999999",
  display_name: "測試商家",
  public_slug: "test123",
  contact_email: "test@example.com",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

function postRequest(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/dashboard/onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/dashboard/onboarding", () => {
  it("未登入 → 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(postRequest({ display_name: "測試商家" }));

    expect(res.status).toBe(401);
    expect(mockOnboardMerchant).not.toHaveBeenCalled();
  });

  it("display_name 空白 → 400", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "test@example.com" } },
    });

    const res = await POST(postRequest({ display_name: "" }));

    expect(res.status).toBe(400);
    expect(mockOnboardMerchant).not.toHaveBeenCalled();
  });

  it("新建 merchant → 201", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: MERCHANT.id, email: MERCHANT.contact_email } },
    });
    mockOnboardMerchant.mockResolvedValue({ merchant: MERCHANT, created: true });

    const res = await POST(postRequest({ display_name: "測試商家" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.merchant).toEqual(MERCHANT);
    expect(mockOnboardMerchant).toHaveBeenCalledWith(
      MERCHANT.id,
      MERCHANT.contact_email,
      "測試商家",
    );
  });

  it("已有 merchant（冪等命中）→ 200", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: MERCHANT.id, email: MERCHANT.contact_email } },
    });
    mockOnboardMerchant.mockResolvedValue({ merchant: MERCHANT, created: false });

    const res = await POST(postRequest({ display_name: "測試商家" }));

    expect(res.status).toBe(200);
  });
});
