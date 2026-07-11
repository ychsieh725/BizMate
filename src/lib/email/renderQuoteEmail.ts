import type { Tables } from "@/lib/supabase/database.types.ts";

export type RenderQuoteEmailParams = {
  merchant: Tables<"merchants">;
  quote: Tables<"quotes">;
  lineItems: Tables<"price_line_items">[];
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function formatTwd(amount: number | null): string {
  if (amount === null) {
    return "—";
  }
  return `NT$ ${amount.toLocaleString("en-US")}`;
}

/** 避免商家名稱/品項名稱含 HTML 特殊字元時破壞版面或造成注入（security.md）。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 渲染最終報價單 Email（deterministic 純函式，5.8）。
 * 明細加總恆等於 quote.final_amount（5.7 的原子 RPC 保證），本函式不需要
 * 也不處理兩者對不上的情況。
 */
export function renderQuoteEmail(params: RenderQuoteEmailParams): RenderedEmail {
  const { merchant, quote, lineItems } = params;
  const subject = `您的報價單已送達（${quote.quote_code}）`;

  const conservativeNotice = quote.is_conservative
    ? "（此報價因部分資訊不足，採保守估算，如有疑問歡迎回信詢問）"
    : "";

  const itemLines = lineItems.map(
    (item) => `${item.item_name}　${formatTwd(item.amount)}`,
  );

  const text = [
    `${merchant.display_name} 為您準備的報價單`,
    "──────────────",
    ...itemLines,
    "──────────────",
    `總計　${formatTwd(quote.final_amount)}`,
    conservativeNotice,
    "",
    "如需調整，歡迎直接回覆本信與我們討論。",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const itemRows = lineItems
    .map(
      (item) =>
        `<tr><td style="padding:4px 8px;">${escapeHtml(item.item_name)}</td>` +
        `<td style="padding:4px 8px;text-align:right;">${formatTwd(item.amount)}</td></tr>`,
    )
    .join("");

  const html = [
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">',
    `<h2>${escapeHtml(merchant.display_name)} 為您準備的報價單</h2>`,
    '<table style="width:100%;border-collapse:collapse;">',
    itemRows,
    `<tr><td style="padding:8px;font-weight:bold;">總計</td>` +
      `<td style="padding:8px;text-align:right;font-weight:bold;">${formatTwd(quote.final_amount)}</td></tr>`,
    "</table>",
    quote.is_conservative
      ? `<p style="color:#92400e;">${escapeHtml(conservativeNotice)}</p>`
      : "",
    "<p>如需調整，歡迎直接回覆本信與我們討論。</p>",
    "</div>",
  ]
    .filter((line) => line !== "")
    .join("");

  return { subject, html, text };
}
