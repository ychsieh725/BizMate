import { expect, type Page } from "@playwright/test";

/** /onboarding 頁的 Page Object。 */
export class OnboardingPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/onboarding");
  }

  /** 等 onboarding 表單出現（登入後被導向 onboarding 的可觀察結果）。 */
  async waitForForm(): Promise<void> {
    await expect(this.page.locator("#display_name")).toBeVisible();
  }

  /**
   * 填商家名稱送出；成功後 router.push("/dashboard")。
   * Next 16 的 server action / 中介層是 soft navigation，URL 追蹤不可靠，
   * 故以「dashboard 專屬元素出現」為完成信號，而非 waitForURL。
   */
  async completeOnboarding(displayName: string): Promise<void> {
    await this.page.locator("#display_name").fill(displayName);
    await this.page.getByTestId("onboarding-submit").click();
    await expect(this.page.getByTestId("dashboard-nav-services")).toBeVisible();
  }
}
