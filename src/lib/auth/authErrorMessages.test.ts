import { describe, it, expect } from "vitest";
import { toFriendlyAuthError } from "./authErrorMessages.ts";

describe("toFriendlyAuthError", () => {
  it("帳密錯誤轉為中文訊息", () => {
    expect(toFriendlyAuthError("Invalid login credentials")).toBe(
      "帳號或密碼錯誤",
    );
  });

  it("Email 已註冊轉為中文訊息", () => {
    expect(toFriendlyAuthError("User already registered")).toBe(
      "此 Email 已被註冊",
    );
  });

  it("密碼太短轉為中文訊息", () => {
    expect(
      toFriendlyAuthError("Password should be at least 6 characters"),
    ).toBe("密碼至少需要 6 個字元");
  });

  it("未驗證信箱轉為中文訊息", () => {
    expect(toFriendlyAuthError("Email not confirmed")).toBe(
      "請先完成信箱驗證",
    );
  });

  it("未知錯誤訊息回傳通用 fallback，不外洩原始訊息", () => {
    expect(toFriendlyAuthError("some internal supabase detail")).toBe(
      "發生未預期的錯誤，請稍後再試",
    );
  });
});
