import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignOut = vi.fn();

vi.mock("@/lib/supabase/serverClient.ts", () => ({
  createClient: vi.fn(async () => ({
    auth: { signOut: mockSignOut },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

import { redirect } from "next/navigation";
import { logoutAction } from "./actions.ts";

const mockRedirect = vi.mocked(redirect);

beforeEach(() => {
  vi.clearAllMocks();
  mockSignOut.mockResolvedValue({ error: null });
});

describe("logoutAction", () => {
  it("呼叫 Supabase signOut 後導向 /login", async () => {
    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
