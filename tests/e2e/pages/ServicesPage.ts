import { expect, type Page } from "@playwright/test";

/** /dashboard/services 頁的 Page Object（改價 inline edit）。 */
export class ServicesPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/dashboard/services");
  }

  /**
   * 改指定 rate_card_base 列的基礎價格並儲存，等 PATCH 回應成功。
   * 用 row id 定位（testid 帶 id），不依賴列的顯示順序。
   */
  async setBasePrice(rowId: string, newPrice: number): Promise<void> {
    const input = this.page.getByTestId(`service-base-price-${rowId}`);
    await expect(input).toBeVisible();
    await input.fill(String(newPrice));

    const savePromise = this.page.waitForResponse(
      (res) =>
        res.url().includes(`/api/dashboard/services/${rowId}`) &&
        res.request().method() === "PATCH",
    );
    await this.page.getByTestId(`service-save-${rowId}`).click();
    const res = await savePromise;
    expect(res.ok(), "PATCH 改價應回 2xx").toBeTruthy();
  }

  /** 重新載入頁面後讀該列輸入框的值（證明改動真的持久化到 DB）。 */
  async readBasePriceAfterReload(rowId: string): Promise<string> {
    await this.page.reload();
    const input = this.page.getByTestId(`service-base-price-${rowId}`);
    await expect(input).toBeVisible();
    return input.inputValue();
  }
}
