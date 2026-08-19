/**
 * 清理 verify:* 腳本殘留的測試帳號（WBS 8.5）。
 *
 * 執行：
 *   pnpm verify:clean                只檢視，不刪（預設 dry-run）
 *   pnpm verify:clean --confirm       實際刪除
 *   pnpm verify:clean --max-age=0     取消保護期（僅限確定沒有併行執行時）
 *
 * ── 為何需要它 ──
 * 9 支會寫入 DB 的 verify 腳本都用 try/finally 自清，正常路徑不留垃圾。
 * 但 CI 逾時或 job 被取消時 finally 不會跑。接進 CI 後這從「偶爾」變成
 * 「每次逾時都發生」，而 dev 與 production 共用同一個 Supabase 專案。
 *
 * ── 為何預設不刪 ──
 * 刪 auth.users 會沿 CASCADE 帶走該商家的全部資料且無法復原。挑選條件寫在
 * `src/shared/testData/testAccounts.ts` 並由單元測試守著（最危險的一則是
 * dev@bizmate.local 與 verify-*@bizmate-test.local 只差一個 `-test`），
 * 但條件正確不代表可以無聲執行——一律先印出影響範圍。
 */
import { createClient } from "@supabase/supabase-js";

import { env } from "../src/lib/env.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";
import type { AuthAccount } from "@/shared/testData/testAccounts.ts";
import {
  DEFAULT_STALE_AFTER_MS,
  TEST_ACCOUNT_EMAIL_SUFFIX,
  selectStaleTestAccounts,
} from "@/shared/testData/testAccounts.ts";

const admin = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const confirm = process.argv.includes("--confirm");

/** `--max-age=<小時>`；未給則用預設保護期。給 0 代表不設保護期。 */
function staleAfterMs(): number {
  const arg = process.argv.find((value) => value.startsWith("--max-age="));
  if (arg == null) return DEFAULT_STALE_AFTER_MS;

  const hours = Number.parseFloat(arg.split("=")[1] ?? "");
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`--max-age 必須是非負數（小時），收到「${arg}」`);
  }
  return hours * 60 * 60 * 1000;
}

/**
 * 分頁列出全部 auth 使用者。
 *
 * listUsers 預設只回第一頁；不翻頁的話清理會隨著帳號變多而悄悄失效——症狀是
 * 「跑了但沒清乾淨」，比直接失敗更難察覺。
 */
async function listAllAccounts(): Promise<readonly AuthAccount[]> {
  const perPage = 1000;
  const accounts: AuthAccount[] = [];

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`列出使用者失敗：${error.message}`);

    accounts.push(
      ...data.users.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        created_at: user.created_at,
      })),
    );

    if (data.users.length < perPage) return accounts;
  }
}

async function main(): Promise<void> {
  const maxAgeMs = staleAfterMs();
  console.log(`verify 測試資料清理｜模式：${confirm ? "實際刪除" : "dry-run（僅檢視）"}`);
  console.log(`標記依據：信箱結尾為 ${TEST_ACCOUNT_EMAIL_SUFFIX}`);
  console.log(`保護期　：建立超過 ${(maxAgeMs / 3_600_000).toFixed(1)} 小時才納入`);

  const accounts = await listAllAccounts();
  const stale = selectStaleTestAccounts(accounts, new Date(), maxAgeMs);

  console.log(`\n掃描 ${accounts.length} 個帳號，符合清理條件：${stale.length} 個`);
  for (const account of stale) {
    console.log(`  ${account.email}（建立於 ${account.created_at}）`);
  }

  if (stale.length === 0) {
    console.log("\n🎉 沒有殘留的測試帳號。");
    return;
  }
  if (!confirm) {
    console.log("\n（dry-run，未刪除。加 --confirm 才會實際執行）");
    return;
  }

  // 逐一刪除並各自容錯：一個帳號刪不掉（例如被 NO ACTION 外鍵擋住）不該讓
  // 其餘的殘留下來，但也不能靜默——最後統一回報失敗清單。
  const failed: string[] = [];
  for (const account of stale) {
    const { error } = await admin.auth.admin.deleteUser(account.id);
    if (error) failed.push(`${account.email}（${error.message}）`);
  }

  console.log(`\n✅ 已刪除 ${stale.length - failed.length} 個測試帳號（商家資料 CASCADE 連帶清除）`);
  if (failed.length > 0) {
    throw new Error(`以下 ${failed.length} 個帳號刪除失敗，需人工處理：\n  ${failed.join("\n  ")}`);
  }
}

main().catch((error: unknown) => {
  console.error("verify 測試資料清理失敗：", error);
  process.exit(1);
});
