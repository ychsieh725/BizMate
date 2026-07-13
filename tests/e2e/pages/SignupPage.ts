import { type Locator, type Page } from "@playwright/test";

/** /signup 頁的 Page Object。 */
export class SignupPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/signup");
  }

  async submit(email: string, password: string): Promise<void> {
    await this.page.locator("#email").fill(email);
    await this.page.locator("#password").fill(password);
    await this.page.getByTestId("signup-submit").click();
  }

  verificationSent(): Locator {
    return this.page.getByTestId("signup-verification-sent");
  }
}
