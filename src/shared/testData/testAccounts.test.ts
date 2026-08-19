/**
 * 測試帳號的辨識與挑選（WBS 8.5）。
 *
 * 這支純函式決定「哪些 auth 使用者可以被刪掉」。刪 auth.users 會沿 CASCADE
 * 帶走該商家的全部資料，而 dev 與 production 共用同一個 Supabase 專案
 * （免費層 2 專案上限的取捨，見 docs/deployment.md）——**判斷錯誤的代價是刪掉
 * 真實資料，且無法復原**。
 *
 * 故此處測的重點不是「挑得出來」，而是「絕不多挑」：最危險的一則是
 * dev@bizmate.local 與 verify-*@bizmate-test.local 只差一個 `-test`。
 */
import { describe, expect, it } from "vitest";

import { TEST_ACCOUNT_EMAIL_SUFFIX, selectStaleTestAccounts } from "./testAccounts.ts";

const NOW = new Date("2026-08-18T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function account(email: string, hoursAgo: number) {
  return {
    id: `id-${email}`,
    email,
    created_at: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
  };
}

describe("selectStaleTestAccounts", () => {
  it("挑出逾時的測試帳號", () => {
    const stale = selectStaleTestAccounts(
      [account("verify-auth-a-123@bizmate-test.local", 5)],
      NOW,
      2 * HOUR,
    );

    expect(stale.map((a) => a.email)).toEqual(["verify-auth-a-123@bizmate-test.local"]);
  });

  it("放過 dev@bizmate.local —— 與測試網域只差一個 -test，刪掉就毀了本機環境", () => {
    expect(selectStaleTestAccounts([account("dev@bizmate.local", 999)], NOW, 2 * HOUR)).toEqual([]);
  });

  it("放過任何非測試網域的帳號，即使很舊", () => {
    const accounts = [
      account("someone@gmail.com", 9999),
      account("owner@example.com", 9999),
      account("eval@bizmate.local", 9999),
    ];

    expect(selectStaleTestAccounts(accounts, NOW, 2 * HOUR)).toEqual([]);
  });

  it("放過還在保護期內的測試帳號 —— 另一個 CI job 可能正在用它", () => {
    expect(
      selectStaleTestAccounts([account("verify-quotes-1@bizmate-test.local", 1)], NOW, 2 * HOUR),
    ).toEqual([]);
  });

  it("恰好等於保護期的帳號放過 —— 邊界上寧可少刪", () => {
    expect(
      selectStaleTestAccounts([account("verify-quotes-1@bizmate-test.local", 2)], NOW, 2 * HOUR),
    ).toEqual([]);
  });

  it("email 為 null 的帳號一律放過 —— 認不出來就不動它", () => {
    const accounts = [{ id: "x", email: null, created_at: NOW.toISOString() }];

    expect(selectStaleTestAccounts(accounts, NOW, 2 * HOUR)).toEqual([]);
  });

  it("網域比對不分大小寫 —— Supabase 會把 email 正規化為小寫，但不倚賴這件事", () => {
    const accounts = [account("VERIFY-Auth-1@BizMate-Test.Local", 5)];

    expect(selectStaleTestAccounts(accounts, NOW, 2 * HOUR)).toHaveLength(1);
  });

  it("只比對結尾 —— 把測試網域寫在中間的位址不算數", () => {
    const accounts = [account("a@bizmate-test.local.evil.com", 999)];

    expect(selectStaleTestAccounts(accounts, NOW, 2 * HOUR)).toEqual([]);
  });

  it("created_at 無法解析的帳號一律放過", () => {
    const accounts = [{ id: "x", email: `a${TEST_ACCOUNT_EMAIL_SUFFIX}`, created_at: "不是時間" }];

    expect(selectStaleTestAccounts(accounts, NOW, 2 * HOUR)).toEqual([]);
  });
});
