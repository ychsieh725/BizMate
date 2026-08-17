import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/domains/pricing/basePricing.ts", () => ({
  computeBasePricing: vi.fn(),
}));

import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import { POST } from "@/app/api/internal/pricing/compute/route.ts";

/**
 * 內部計價端點——不變式 I-1 的落地點。
 *
 * agent-service（Python）沒有計價邏輯，只能呼叫這個端點取得金額。
 * 「agent 在架構上沒有能力算錢」這句話能不能成立，取決於兩件事：
 *   1. 這個端點只接受欄位值，**不接受任何金額**
 *   2. 回傳的金額完全由 computeBasePricing 決定，請求方無從影響
 * 底下的測試就是這兩件事的機械化驗收。
 */

const mockCompute = vi.mocked(computeBasePricing);
const SECRET = "a-sufficiently-long-secret";
const MERCHANT_ID = "550e8400-e29b-41d4-a716-446655440000";

const VALID_BODY = {
  merchant_id: MERCHANT_ID,
  category: "graphic_design",
  fields: {
    subtype: { value: "品牌識別設計" },
    quantity: { value: "3" },
  },
};

const PRICING_RESULT = {
  lineItems: [
    {
      itemName: "品牌識別設計 × 3",
      amount: 48000,
      ruleId: "rule-1",
      modifierId: null,
      agentReasoning: null,
    },
  ],
  total: 48000,
  outOfScope: false,
};

function post(body: unknown, secret: string | null = SECRET, raw = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-internal-secret"] = secret;

  return POST(
    new Request("http://localhost/api/internal/pricing/compute", {
      method: "POST",
      headers,
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INTERNAL_SERVICE_SECRET", SECRET);
  mockCompute.mockResolvedValue(PRICING_RESULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/internal/pricing/compute — 認證", () => {
  it("未帶 secret → 401，且不進計價", async () => {
    const res = await post(VALID_BODY, null);

    expect(res.status).toBe(401);
    expect(mockCompute).not.toHaveBeenCalled();
  });

  it("secret 錯誤 → 401，且不進計價", async () => {
    const res = await post(VALID_BODY, "wrong-value");

    expect(res.status).toBe(401);
    expect(mockCompute).not.toHaveBeenCalled();
  });

  it("認證先於驗證——非法主體配錯 secret 仍回 401", async () => {
    const res = await post({ garbage: true }, "wrong-value");

    expect(res.status).toBe(401);
  });

  it("401 訊息不洩漏期望的 secret", async () => {
    const res = await post(VALID_BODY, null);

    expect(await res.text()).not.toContain(SECRET);
  });
});

describe("POST /api/internal/pricing/compute — 輸入驗證", () => {
  it("非 JSON → 400", async () => {
    const res = await post("不是JSON{{", SECRET, true);

    expect(res.status).toBe(400);
    expect(mockCompute).not.toHaveBeenCalled();
  });

  it("merchant_id 非 UUID → 400", async () => {
    const res = await post({ ...VALID_BODY, merchant_id: "not-a-uuid" });

    expect(res.status).toBe(400);
  });

  it("category 不在允許值域 → 400", async () => {
    const res = await post({ ...VALID_BODY, category: "not_a_category" });

    expect(res.status).toBe(400);
  });

  it("缺 fields → 400", async () => {
    const res = await post({ merchant_id: MERCHANT_ID, category: "graphic_design" });

    expect(res.status).toBe(400);
  });

  it("接受 value 為 null 的欄位（代表原文未提及）", async () => {
    const res = await post({
      ...VALID_BODY,
      fields: { subtype: { value: null } },
    });

    expect(res.status).toBe(200);
  });
});

describe("POST /api/internal/pricing/compute — 不變式 I-1", () => {
  it("回傳的金額來自 computeBasePricing", async () => {
    const res = await post(VALID_BODY);
    const body = await res.json();

    expect(body.data.total).toBe(48000);
  });

  it("請求夾帶 total 也無法影響回傳金額", async () => {
    const res = await post({ ...VALID_BODY, total: 1, final_amount: 1 });
    const body = await res.json();

    expect(body.data.total).toBe(48000);
  });

  it("請求夾帶的金額欄位不會被傳進計價函式", async () => {
    await post({ ...VALID_BODY, total: 1, amount: 999 });

    const [, , fields] = mockCompute.mock.calls[0];
    expect(fields).toEqual(VALID_BODY.fields);
  });

  it("以請求指定的 merchant 與 category 計價", async () => {
    await post(VALID_BODY);

    expect(mockCompute).toHaveBeenCalledWith(
      MERCHANT_ID,
      "graphic_design",
      VALID_BODY.fields,
    );
  });
});

describe("POST /api/internal/pricing/compute — 回應", () => {
  it("成功 → 200 並帶 snake_case 酬載", async () => {
    const res = await post(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.out_of_scope).toBe(false);
    expect(body.data.line_items[0].item_name).toBe("品牌識別設計 × 3");
    expect(body.data.line_items[0].rule_id).toBe("rule-1");
  });

  it("超出服務範圍 → out_of_scope 為 true", async () => {
    mockCompute.mockResolvedValue({ lineItems: [], total: 0, outOfScope: true });

    const res = await post(VALID_BODY);
    const body = await res.json();

    expect(body.data.out_of_scope).toBe(true);
  });

  it("計價拋錯 → 500，不洩漏內部細節", async () => {
    mockCompute.mockRejectedValue(new Error("rate_card 連線失敗"));

    const res = await post(VALID_BODY);

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("rate_card 連線失敗");
  });
});
