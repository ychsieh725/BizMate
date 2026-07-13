import { expect, type Page } from "@playwright/test";

/**
 * 匿名客戶報價精靈 /q/{slug} 的 Page Object。
 * 這一段跑在獨立的 incognito context（非商家登入態）。
 */
export class CustomerWizardPage {
  constructor(private readonly page: Page) {}

  async goto(slug: string): Promise<void> {
    await this.page.goto(`/q/${slug}`);
  }

  /**
   * Step 1 選類型 → 觸發 POST /api/sessions → 進 Step 2。
   * 若被限流（429）或建 session 失敗，會停在類型步驟並顯示 alert，
   * 此時明確拋錯（帶伺服器訊息），不靜默略過。
   */
  async selectCategory(category: string): Promise<void> {
    const sessionResponse = this.page.waitForResponse(
      (res) =>
        res.url().includes("/api/sessions") &&
        res.request().method() === "POST",
    );
    await this.page.getByTestId(`category-option-${category}`).click();
    const res = await sessionResponse;
    if (!res.ok()) {
      const body = await res.text();
      throw new Error(
        `建立 session 失敗（HTTP ${res.status()}）——可能觸發 /api/sessions 限流：${body}`,
      );
    }
    await expect(this.page.getByTestId("describe-raw-text")).toBeVisible();
  }

  /**
   * Step 2 填描述 + email 送出 → 等 /describe 回應 → 進結果頁。
   * 用已知能跳過反問的 golden input，預期直接落到 awaiting_review 報價。
   */
  async describe(rawText: string, contactEmail: string): Promise<void> {
    await this.page.getByTestId("describe-raw-text").fill(rawText);
    await this.page.getByTestId("describe-email").fill(contactEmail);

    const describeResponse = this.page.waitForResponse(
      (res) =>
        /\/api\/sessions\/[^/]+\/describe/.test(res.url()) &&
        res.request().method() === "POST",
    );
    await this.page.getByTestId("describe-submit").click();
    const res = await describeResponse;
    if (!res.ok()) {
      const body = await res.text();
      throw new Error(`/describe 失敗（HTTP ${res.status()}）：${body}`);
    }
  }

  /**
   * 斷言結果頁落在「已收到需求（有報價編號）」，回傳報價編號文字。
   * 若反而落到「還差一點資訊」（Gemini 仍反問），明確拋錯——不用 retry 掩蓋。
   */
  async expectQuoteAcceptedAndGetCode(): Promise<string> {
    const quoteCode = this.page.getByTestId("result-quote-code");
    const clarification = this.page.getByTestId("result-missing-fields");
    const outOfScope = this.page.getByTestId("result-out-of-scope");

    await expect(
      quoteCode.or(clarification).or(outOfScope),
      "結果頁應顯示三種結局之一",
    ).toBeVisible({ timeout: 30_000 });

    if (await clarification.isVisible()) {
      throw new Error(
        "非預期：golden input 仍觸發反問（awaiting_clarification）。" +
          "這代表 Gemini 抽取信心分數不穩，屬於需要回報的 flaky，不做 retry 掩蓋。",
      );
    }
    if (await outOfScope.isVisible()) {
      throw new Error("非預期：golden input 被判定超出報價範圍（out_of_scope）。");
    }

    await expect(quoteCode).toBeVisible();
    return (await quoteCode.textContent())?.trim() ?? "";
  }
}
