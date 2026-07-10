import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignInWithPassword = vi.fn();

vi.mock("@/lib/supabase/serverClient.ts", () => ({
  createClient: vi.fn(async () => ({
    auth: { signInWithPassword: mockSignInWithPassword },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

import { redirect } from "next/navigation";
import { loginAction } from "./actions.ts";

const mockRedirect = vi.mocked(redirect);

function buildFormData(fields: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => data.append(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loginAction", () => {
  it("Email 或密碼空白時回傳錯誤，不呼叫 Supabase", async () => {
    const result = await loginAction(
      { error: null },
      buildFormData({ email: "", password: "" }),
    );

    expect(result.error).toBe("請輸入 Email 與密碼");
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("帳密錯誤時回傳友善中文訊息", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    const result = await loginAction(
      { error: null },
      buildFormData({ email: "a@test.com", password: "wrong" }),
    );

    expect(result.error).toBe("帳號或密碼錯誤");
  });

  it("登入成功導向 /dashboard", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    await expect(
      loginAction(
        { error: null },
        buildFormData({ email: "a@test.com", password: "correct" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });
});
