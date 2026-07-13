import { expect, test } from "@playwright/test";
import { SignupPage } from "./pages/SignupPage";
import { cleanupUser, findUserIdByEmail } from "./support/testData";

/**
 * 輕量情境：實際驅動 /signup 表單一次，證明「註冊 UI 端到端可用」
 *（表單渲染 → server action → Supabase 往返 → 依回應更新畫面）。
 *
 * 本 dev Supabase 專案「整站關閉公開註冊」（signUp 回 422 signup_disabled：
 * Signups not allowed for this instance）——這也是整個 codebase 一律改用
 * service_role admin.createUser 預備測試帳號的根本原因。因此這裡不能斷言
 * 「驗證信已寄出」那種需要開放註冊才會出現的狀態；能穩定成立且誠實的斷言是：
 * 表單送出後畫面落在三種結局之一並印出實際命中哪個：
 *   1. 驗證信已寄出（若未來 dev 專案開啟註冊 + email 驗證）
 *   2. 直接導向 /dashboard（若開啟註冊且關閉 email 驗證）
 *   3. 顯示錯誤 alert（目前情況：註冊被停用，UI 有優雅處理，未白畫面/未 crash）
 *
 * 金路徑（critical-path.spec.ts）不受此影響：它走 admin 預備帳號 + /login。
 */
test.describe("註冊 UI（signup）", () => {
  const email = `e2e-signup-${Date.now()}@bizmate-test.local`;
  const password = "E2eSignupTest123";

  test.afterAll(async () => {
    // 若這台 dev 專案其實有建成帳號（未來開放註冊時），仍清乾淨。
    const userId = await findUserIdByEmail(email);
    await cleanupUser(userId);
  });

  test("送出註冊後，畫面落在驗證提示／dashboard／錯誤三者之一", async ({ page }) => {
    const signup = new SignupPage(page);
    await signup.goto();

    // 表單有正確渲染欄位與送出鈕。
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();

    await signup.submit(email, password);

    const alert = page.getByRole("alert");
    await expect(async () => {
      const onDashboard = /\/dashboard/.test(page.url());
      const sent = await signup.verificationSent().isVisible();
      const errored = await alert.isVisible();
      expect(
        onDashboard || sent || errored,
        "註冊後應顯示驗證提示、導向 dashboard，或顯示錯誤 alert",
      ).toBeTruthy();
    }).toPass({ timeout: 15_000 });

    if (/\/dashboard/.test(page.url())) {
      console.log("[signup] 命中：註冊直接建立 session → /dashboard（開放註冊且關閉 email 驗證）");
    } else if (await signup.verificationSent().isVisible()) {
      console.log("[signup] 命中：驗證信已寄出（開放註冊且開啟 email 驗證）");
    } else {
      const message = (await alert.textContent())?.trim();
      console.log(
        `[signup] 命中：錯誤 alert「${message}」——此 dev 專案關閉公開註冊（signup_disabled），` +
          "UI 有優雅處理。金路徑改走 admin 預備帳號 + /login。",
      );
    }
  });
});
