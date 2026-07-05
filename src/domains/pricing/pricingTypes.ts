/**
 * 報價項目（對應 price_line_items，計算階段尚未持久化）。
 * 基礎費項目帶 ruleId；加成項目帶 modifierId。deterministic 項目 agentReasoning 為 null，
 * 由 4.3 Pricing Agent 產出的區間加成才會填 reasoning。
 */
export interface LineItem {
  readonly itemName: string;
  readonly amount: number;
  readonly ruleId: string | null;
  readonly modifierId: string | null;
  readonly agentReasoning: string | null;
}

/** 一次計價的完整結果。 */
export interface PricingResult {
  readonly lineItems: LineItem[];
  readonly total: number;
  /** 查無對應 rate_card_base 子類型時為 true，轉人工評估（FR-PR-3）。 */
  readonly outOfScope: boolean;
}

/**
 * 計價的最小輸入形狀：只需各欄位的字串值，不依賴 intake 的完整 FieldExtraction，
 * 讓 pricing 與 intake 解耦（缺漏/confidence 判斷已在 Parser 完成）。
 */
export type ExtractedValues = Record<
  string,
  { readonly value: string | null } | undefined
>;
