import { expect, test, type BrowserContext } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ServicesPage } from "./pages/ServicesPage";
import { CustomerWizardPage } from "./pages/CustomerWizardPage";
import { QuotesPage } from "./pages/QuotesPage";
import { E2E_ENV } from "./support/env";
import {
  cleanupUser,
  getLatestQuote,
  getMerchantSlug,
  getQuoteById,
  getRateCardBasePrice,
  getRateCardRows,
  provisionConfirmedUser,
  type ProvisionedUser,
} from "./support/testData";

/**
 * WBS 8.2 關鍵旅程金路徑（single golden path，非窮舉）：
 *   （預備確認帳號）→ 登入 → onboarding → 改價
 *   → 匿名客戶跑 /q/{slug} 出報價 → 後台確認 → 寄信
 * 對真實 dev stack（Supabase / Gemini / Resend）端到端執行。
 *
 * 註冊這一步為何用 admin 預備帳號：真實 /signup 會卡在 email 驗證（dev 專案
 * 開啟驗證時無法在此環境收信），故金路徑用 service_role 建「已確認」帳號、
 * 走沒有驗證阻擋的 /login 進場，再從 onboarding 起跑真實旅程——
 * 與 scripts/verify-auth.ts 的既有慣例一致。signup UI 本身另由 signup.spec.ts 覆蓋。
 */

// golden input：verify-describe.ts 已驗證能跳過反問、直接落到 awaiting_review 報價。
const GOLDEN_CATEGORY = "illustration";
const GOLDEN_DESCRIPTION =
  "幫我畫 1 個角色設計，精緻上色，需要高解析度印刷檔，商業使用，三天內交件，含 2 次修改";
const NEW_BASE_PRICE = 4321;

test.describe.configure({ mode: "serial" });

test.describe("關鍵旅程：註冊→onboarding→改價→匿名報價→後台確認→寄信", () => {
  let merchant: ProvisionedUser | null = null;
  let customerContext: BrowserContext | null = null;

  test.beforeAll(async () => {
    merchant = await provisionConfirmedUser("critical");
  });

  test.afterAll(async () => {
    if (customerContext) await customerContext.close();
    await cleanupUser(merchant?.userId ?? null);
  });

  test("golden path 端到端", async ({ page, browser }) => {
    if (merchant === null) throw new Error("beforeAll 未成功預備測試帳號");
    const activeMerchant = merchant;

    const onboarding = new OnboardingPage(page);
    await test.step("登入（未建商家 → 被導向 onboarding）", async () => {
      const login = new LoginPage(page);
      await login.goto();
      await login.login(activeMerchant.email, activeMerchant.password);
      // 中介層把 /dashboard 導回 /onboarding；以表單出現為登入成功信號。
      await onboarding.waitForForm();
    });

    await test.step("onboarding：建立商家 + 複製範本價目表", async () => {
      await onboarding.completeOnboarding("E2E 關鍵旅程商家");

      const rows = await getRateCardRows(activeMerchant.userId);
      expect(rows.length, "onboarding 應複製範本 rate_card_base").toBeGreaterThan(0);
    });

    let targetRowId = "";
    await test.step("改價：inline 編輯 illustration 列的基礎價格並持久化", async () => {
      const rows = await getRateCardRows(activeMerchant.userId);
      const target =
        rows.find((row) => row.category === GOLDEN_CATEGORY) ?? rows[0];
      targetRowId = target.id;

      const services = new ServicesPage(page);
      await services.goto();
      await services.setBasePrice(targetRowId, NEW_BASE_PRICE);

      const reloadedValue = await services.readBasePriceAfterReload(targetRowId);
      expect(Number(reloadedValue), "重載後 UI 應顯示新價").toBe(NEW_BASE_PRICE);

      const dbValue = await getRateCardBasePrice(targetRowId);
      expect(Number(dbValue), "DB 應持久化新價").toBe(NEW_BASE_PRICE);
    });

    const slug = await getMerchantSlug(activeMerchant.userId);
    let uiQuoteCode = "";
    await test.step("匿名客戶：無痕跑 /q/{slug} 出報價", async () => {
      customerContext = await browser.newContext();
      const customerPage = await customerContext.newPage();
      const wizard = new CustomerWizardPage(customerPage);

      await wizard.goto(slug);
      await wizard.selectCategory(GOLDEN_CATEGORY);
      await wizard.describe(GOLDEN_DESCRIPTION, E2E_ENV.emailRecipient);
      uiQuoteCode = await wizard.expectQuoteAcceptedAndGetCode();
      expect(uiQuoteCode, "應取得報價編號").not.toBe("");
    });

    let quoteId = "";
    await test.step("後台：確認匿名客戶送來的待審報價", async () => {
      const quote = await getLatestQuote(activeMerchant.userId);
      expect(quote, "DB 應有一筆報價").not.toBeNull();
      expect(quote!.status, "新報價應為 awaiting_review").toBe("awaiting_review");
      expect(quote!.quote_code, "DB 報價編號應與客戶端顯示一致").toBe(uiQuoteCode);
      quoteId = quote!.id;

      const quotes = new QuotesPage(page);
      await quotes.gotoList();
      await quotes.expectQuoteVisibleInList(uiQuoteCode);

      await quotes.gotoDetail(quoteId);
      await quotes.confirm(quoteId);

      const confirmed = await getQuoteById(quoteId);
      expect(confirmed!.status, "確認後狀態應為 confirmed").toBe("confirmed");
    });

    await test.step("寄信：寄送最終報價單（真實 Resend）", async () => {
      const quotes = new QuotesPage(page);
      await quotes.gotoDetail(quoteId); // 重載取得 confirmed 狀態下的寄送按鈕
      await quotes.send(quoteId);

      const sent = await getQuoteById(quoteId);
      expect(sent!.status, "寄送後狀態應為 sent").toBe("sent");
      expect(sent!.sent_at, "sent_at 應已寫入").not.toBeNull();
    });
  });
});
