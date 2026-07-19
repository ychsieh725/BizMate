import { describe, it, expect } from "vitest";
import { decideRedirect, needsMerchantLookup } from "./redirectDecision.ts";

describe("decideRedirect", () => {
  it("未登入訪問 /dashboard 導向 /login", () => {
    expect(decideRedirect("/dashboard", false)).toBe("/login");
  });

  it("未登入訪問 /dashboard/services 導向 /login", () => {
    expect(decideRedirect("/dashboard/services", false)).toBe("/login");
  });

  it("未登入訪問 /onboarding 導向 /login", () => {
    expect(decideRedirect("/onboarding", false)).toBe("/login");
  });

  it("已登入訪問 /dashboard 不重導", () => {
    expect(decideRedirect("/dashboard", true)).toBeNull();
  });

  it("已登入訪問 /login 導向 /dashboard", () => {
    expect(decideRedirect("/login", true)).toBe("/dashboard");
  });

  it("已登入訪問 /signup 導向 /dashboard", () => {
    expect(decideRedirect("/signup", true)).toBe("/dashboard");
  });

  it("未登入訪問 /login 不重導", () => {
    expect(decideRedirect("/login", false)).toBeNull();
  });

  it("未登入訪問公開頁 / 不重導", () => {
    expect(decideRedirect("/", false)).toBeNull();
  });

  it("已登入訪問公開頁 /q/dev 不重導", () => {
    expect(decideRedirect("/q/dev", true)).toBeNull();
  });

  it("已登入、無 merchant 訪問 /dashboard 導向 /onboarding", () => {
    expect(decideRedirect("/dashboard", true, false)).toBe("/onboarding");
  });

  it("已登入、無 merchant 訪問 /onboarding 不重導", () => {
    expect(decideRedirect("/onboarding", true, false)).toBeNull();
  });

  it("已登入、有 merchant 訪問 /onboarding 導向 /dashboard", () => {
    expect(decideRedirect("/onboarding", true, true)).toBe("/dashboard");
  });

  it("已登入、有 merchant 訪問 /dashboard 不重導（顯式傳入）", () => {
    expect(decideRedirect("/dashboard", true, true)).toBeNull();
  });

  it("已登入、無 merchant 訪問 /login 導向 /onboarding", () => {
    expect(decideRedirect("/login", true, false)).toBe("/onboarding");
  });

  it("已登入、無 merchant 訪問 /signup 導向 /onboarding", () => {
    expect(decideRedirect("/signup", true, false)).toBe("/onboarding");
  });
});

describe("needsMerchantLookup", () => {
  // /dashboard 不需要查：decideRedirect 對 dashboard 的 hasMerchant 分支
  // 交由 layout 守門（requireMerchant 403 → redirect /onboarding），
  // middleware 便可省下每次導覽一次 DB 往返。
  it("/dashboard 及子路徑不需查 merchant", () => {
    expect(needsMerchantLookup("/dashboard")).toBe(false);
    expect(needsMerchantLookup("/dashboard/quotes")).toBe(false);
  });

  it("/onboarding 需查 merchant（有 merchant 者應被導回 /dashboard）", () => {
    expect(needsMerchantLookup("/onboarding")).toBe(true);
  });

  it("/login 與 /signup 需查 merchant（決定導向 /dashboard 或 /onboarding）", () => {
    expect(needsMerchantLookup("/login")).toBe(true);
    expect(needsMerchantLookup("/signup")).toBe(true);
  });
});
