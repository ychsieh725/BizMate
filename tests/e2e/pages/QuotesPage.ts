import { expect, type Page } from "@playwright/test";

/** /dashboard/quotes 報價列表 + /dashboard/quotes/{id} 詳情頁的 Page Object。 */
export class QuotesPage {
  constructor(private readonly page: Page) {}

  async gotoList(): Promise<void> {
    await this.page.goto("/dashboard/quotes");
  }

  /** 在列表確認某報價編號出現（後台看得到匿名客戶送來的需求）。 */
  async expectQuoteVisibleInList(quoteCode: string): Promise<void> {
    await expect(this.page.getByText(quoteCode, { exact: false })).toBeVisible();
  }

  async gotoDetail(quoteId: string): Promise<void> {
    await this.page.goto(`/dashboard/quotes/${quoteId}`);
  }

  /** flag 關閉時的軌跡區塊：必須明說「沒跑 agent」，而非留一片空白。 */
  async expectNoTrajectory(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "AI 決策軌跡" })).toBeVisible();
    await expect(this.page.getByText("此報價未經 agent 處理")).toBeVisible();
  }

  /**
   * 有軌跡時的呈現。斷言涵蓋三件容易寫錯又不會報錯的事：
   * 多趟 loop 有被分開、rejected 沒有被講成失敗、展開後看得到 tool 參數。
   */
  async expectTrajectoryWithTwoRuns(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "AI 決策軌跡" })).toBeVisible();
    await expect(this.page.getByText("第 1 次執行")).toBeVisible();
    await expect(this.page.getByText("第 2 次執行")).toBeVisible();

    // 中文說明與原始 tool 名稱並存：前者給商家，後者給除錯的人
    await expect(this.page.getByText("查詢價目表")).toBeVisible();
    await expect(this.page.getByText("lookup_rate_card")).toBeVisible();

    // 護欄生效不可顯示為失敗
    await expect(this.page.getByText("參數不合規，已重試")).toBeVisible();

    // 展開才看得到細節，且展開是原生 details，不需要等待 JS 水合
    await this.page.getByText("單輪最多 5 題", { exact: false }).first().waitFor({
      state: "attached",
    });
  }

  /**
   * 終審確認：接受 window.confirm，點「確認報價」，等 confirm 端點回應成功。
   */
  async confirm(quoteId: string): Promise<void> {
    this.page.once("dialog", (dialog) => void dialog.accept());
    const confirmResponse = this.page.waitForResponse(
      (res) =>
        res.url().includes(`/api/dashboard/quotes/${quoteId}/confirm`) &&
        res.request().method() === "POST",
    );
    await this.page.getByTestId("quote-confirm").click();
    const res = await confirmResponse;
    expect(res.ok(), "confirm 應回 2xx").toBeTruthy();
  }

  /**
   * 寄送：接受 window.confirm，點「寄送給客戶」，等 send 端點回應成功。
   * 這一步會真的呼叫 Resend 寄出 email。
   */
  async send(quoteId: string): Promise<void> {
    this.page.once("dialog", (dialog) => void dialog.accept());
    const sendResponse = this.page.waitForResponse(
      (res) =>
        res.url().includes(`/api/dashboard/quotes/${quoteId}/send`) &&
        res.request().method() === "POST",
    );
    await this.page.getByTestId("quote-send").click();
    const res = await sendResponse;
    expect(res.ok(), "send 應回 2xx").toBeTruthy();
  }
}
