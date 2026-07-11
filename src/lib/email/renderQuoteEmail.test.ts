import { describe, it, expect } from "vitest";
import { renderQuoteEmail } from "./renderQuoteEmail.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

const MERCHANT: Tables<"merchants"> = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  display_name: "小美設計工作室",
  public_slug: "xiaomei",
  contact_email: "xiaomei@example.com",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
};

const QUOTE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const SESSION_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";

function makeQuote(overrides: Partial<Tables<"quotes">> = {}): Tables<"quotes"> {
  return {
    id: QUOTE_ID,
    session_id: SESSION_ID,
    merchant_id: MERCHANT.id,
    quote_code: "I-2607001",
    final_amount: 7800,
    status: "confirmed",
    pdf_url: null,
    created_at: "2026-07-11T02:00:00.000Z",
    sent_at: null,
    is_conservative: false,
    ...overrides,
  };
}

const LINE_ITEMS: Tables<"price_line_items">[] = [
  {
    id: "l1",
    session_id: SESSION_ID,
    item_name: "角色設計基本費",
    amount: 6000,
    rule_id: "r1",
    modifier_id: null,
    agent_reasoning: null,
    confidence: null,
    created_at: "2026-07-11T01:00:00.000Z",
    updated_at: "2026-07-11T01:00:00.000Z",
  },
  {
    id: "l2",
    session_id: SESSION_ID,
    item_name: "商業使用加成",
    amount: 1800,
    rule_id: null,
    modifier_id: "m1",
    agent_reasoning: null,
    confidence: null,
    created_at: "2026-07-11T01:00:00.000Z",
    updated_at: "2026-07-11T01:00:00.000Z",
  },
];

describe("renderQuoteEmail", () => {
  it("subject 含 quote_code", () => {
    const result = renderQuoteEmail({ merchant: MERCHANT, quote: makeQuote(), lineItems: LINE_ITEMS });
    expect(result.subject).toContain("I-2607001");
  });

  it("html 與 text 皆含商家名、每筆明細與總計", () => {
    const result = renderQuoteEmail({ merchant: MERCHANT, quote: makeQuote(), lineItems: LINE_ITEMS });
    for (const content of [result.html, result.text]) {
      expect(content).toContain("小美設計工作室");
      expect(content).toContain("角色設計基本費");
      expect(content).toContain("NT$ 6,000");
      expect(content).toContain("商業使用加成");
      expect(content).toContain("NT$ 1,800");
      expect(content).toContain("NT$ 7,800");
    }
  });

  it("is_conservative=true 時含保守估算提示", () => {
    const result = renderQuoteEmail({
      merchant: MERCHANT,
      quote: makeQuote({ is_conservative: true }),
      lineItems: LINE_ITEMS,
    });
    expect(result.text).toContain("保守估算");
    expect(result.html).toContain("保守估算");
  });

  it("is_conservative=false 時不含保守估算提示", () => {
    const result = renderQuoteEmail({
      merchant: MERCHANT,
      quote: makeQuote({ is_conservative: false }),
      lineItems: LINE_ITEMS,
    });
    expect(result.text).not.toContain("保守估算");
    expect(result.html).not.toContain("保守估算");
  });

  it("html 會跳脫商家名稱等使用者輸入內容中的特殊字元", () => {
    const result = renderQuoteEmail({
      merchant: { ...MERCHANT, display_name: "<script>alert(1)</script>" },
      quote: makeQuote(),
      lineItems: LINE_ITEMS,
    });
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("final_amount 為 null（商家尚未為 outOfScope 報價定價）時顯示破折號", () => {
    const result = renderQuoteEmail({
      merchant: MERCHANT,
      quote: makeQuote({ final_amount: null }),
      lineItems: [],
    });
    expect(result.text).toContain("—");
  });
});
