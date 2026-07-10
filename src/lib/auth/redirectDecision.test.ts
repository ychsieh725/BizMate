import { describe, it, expect } from "vitest";
import { decideRedirect } from "./redirectDecision.ts";

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
});
