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
