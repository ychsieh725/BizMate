import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignUp = vi.fn();

vi.mock("@/lib/supabase/serverClient.ts", () => ({
  createClient: vi.fn(async () => ({
    auth: { signUp: mockSignUp },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

import { redirect } from "next/navigation";
import { signupAction } from "./actions.ts";

const mockRedirect = vi.mocked(redirect);

function buildFormData(fields: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => data.append(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signupAction", () => {
  it("Email 或密碼空白時回傳錯誤，不呼叫 Supabase", async () => {
    const result = await signupAction(
      { error: null, verificationSent: false },
      buildFormData({ email: "", password: "" }),
    );

    expect(result.error).toBe("請輸入 Email 與密碼");
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("Email 已註冊時回傳友善中文訊息", async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null },
      error: { message: "User already registered" },
    });

    const result = await signupAction(
      { error: null, verificationSent: false },
      buildFormData({ email: "a@test.com", password: "password123" }),
    );

    expect(result.error).toBe("此 Email 已被註冊");
    expect(result.verificationSent).toBe(false);
  });

  it("需驗證信箱時回傳 verificationSent，不重導", async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const result = await signupAction(
      { error: null, verificationSent: false },
      buildFormData({ email: "a@test.com", password: "password123" }),
    );

    expect(result).toEqual({ error: null, verificationSent: true });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("已直接建立 session 時（免驗證專案設定）導向 /dashboard", async () => {
    mockSignUp.mockResolvedValue({
      data: { session: { access_token: "t" } },
      error: null,
    });

    await expect(
      signupAction(
        { error: null, verificationSent: false },
        buildFormData({ email: "a@test.com", password: "password123" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });
});
