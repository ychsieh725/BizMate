/**
 * verify:* 腳本產生的測試帳號標記與清掃條件（WBS 8.5）。
 *
 * ## 為什麼需要清掃
 *
 * 9 支會寫入 DB 的 verify 腳本都已用 `try/finally` + `deleteUser` 自清，正常
 * 路徑不留垃圾。缺的是**中斷路徑**：CI 逾時、job 被取消、runner 被回收——
 * finally 不會跑，測試商家就留在共用的 Supabase 專案裡。接進 CI 之後這件事
 * 從「偶爾發生」變成「每次逾時都發生」。
 *
 * ## 標記方式
 *
 * 全部 verify 腳本的測試帳號都用 `@bizmate-test.local` 結尾（既有慣例，非本
 * 任務新增）。沿用它而不新增欄位，理由與 eval 的 `eval@bizmate.local` 相同：
 * migration 管線（8.6）尚未建立，加欄位得手動套到 production。
 *
 * ## 保護期
 *
 * 刪除條件多一個「建立超過 N 小時」。少了它，兩個併行的 CI job 會互相清掉對方
 * 正在使用的 fixture，症狀是隨機的外鍵錯誤——那種 bug 極難從 CI log 追出來。
 */

/** 測試帳號的網域後綴。與 dev 商家的 `@bizmate.local` 只差 `-test`，不可混用。 */
export const TEST_ACCOUNT_EMAIL_SUFFIX = "@bizmate-test.local";

/** 預設保護期：兩小時。單支 verify 腳本跑不到一分鐘，這個餘裕遠遠足夠。 */
export const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export interface AuthAccount {
  readonly id: string;
  readonly email: string | null;
  readonly created_at: string;
}

function isTestAccount(email: string | null): boolean {
  return email != null && email.toLowerCase().endsWith(TEST_ACCOUNT_EMAIL_SUFFIX);
}

/**
 * 挑出可以安全刪除的測試帳號。
 *
 * 兩個條件都必須成立，且任一條件無法判定（信箱為 null、時間無法解析）時一律
 * 放過。這個方向是刻意的：**漏刪只是留下垃圾，多刪是刪掉別人的資料。**
 */
export function selectStaleTestAccounts(
  accounts: readonly AuthAccount[],
  now: Date,
  staleAfterMs: number,
): readonly AuthAccount[] {
  return accounts.filter((account) => {
    if (!isTestAccount(account.email)) return false;

    const createdAt = Date.parse(account.created_at);
    if (!Number.isFinite(createdAt)) return false;

    return now.getTime() - createdAt > staleAfterMs;
  });
}
