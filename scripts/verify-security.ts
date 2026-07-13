/**
 * 驗證 migration 0007（收回 RPC 的 PUBLIC EXECUTE）是否生效（任務 8.3 驗收）。
 * 執行：pnpm verify:security
 *
 * 用 anon key（未登入）與已登入的測試商家兩種身分，直接呼叫
 * advance_quote_status / adjust_quote_amount / increment_rate_limit 三個 RPC，
 * 證明兩者皆被 EXECUTE 權限擋下（錯誤訊息含 permission denied for function），
 * 而非僅靠函式體內的表權限擋下——這是防禦縱深第二層本身有效的直接證據。
 *
 * 前提：migration 0007_revoke_public_execute.sql 已於 Supabase Studio 手動套用。
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../src/lib/env.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`驗證失敗：${message}`);
  }
}

const admin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

type TestMerchant = { userId: string; email: string; password: string };

async function createTestMerchant(): Promise<TestMerchant> {
  const email = `verify-security-${Date.now()}@bizmate-test.local`;
  const password = "VerifySecurityTest123";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`建立測試商家失敗：${error?.message}`);
  }

  const { error: merchantError } = await admin.from("merchants").insert({
    id: data.user.id,
    display_name: "驗證商家（8.3 安全審查）",
    public_slug: `verify-security-${Date.now()}`,
    contact_email: email,
  });
  if (merchantError) {
    throw new Error(`建立商家列失敗：${merchantError.message}`);
  }

  return { userId: data.user.id, email, password };
}

async function cleanupTestMerchant(merchant: TestMerchant): Promise<void> {
  await admin.auth.admin.deleteUser(merchant.userId).catch(() => {
    console.error(
      `⚠️ 清理測試商家失敗，請至 Supabase Studio 手動刪除 ${merchant.userId}`,
    );
  });
}

async function assertExecuteDenied(
  client: ReturnType<typeof createClient<Database>>,
  label: string,
): Promise<void> {
  const fakeId = randomUUID();

  // 刻意檢查「permission denied for function」而非泛用的「permission denied」——
  // 後者今天（0007 套用前）就已經成立（PUBLIC 預設可 EXECUTE，卡在函式體內
  // 對 quotes/sessions/rate_limits 表無寫入權限），無法證明本次 REVOKE 有效。
  // 只有 EXECUTE 本身被擋下，才會在「還沒進到函式體」就回這個訊息，
  // 這才是本次修復（migration 0007）實際生效的證據。
  const advance = await client.rpc("advance_quote_status", {
    p_quote_id: fakeId,
    p_merchant_id: fakeId,
    p_from_status: "awaiting_review",
    p_to_status: "quote_confirmed",
    p_set_sent_at: false,
  });
  assert(
    advance.error !== null &&
      /permission denied for function/i.test(advance.error.message),
    `${label} 呼叫 advance_quote_status 應被 EXECUTE 權限擋下（實際：${advance.error?.message ?? "未回錯誤"}）——若訊息是 permission denied for table/relation，代表 migration 0007 尚未套用`,
  );

  const adjust = await client.rpc("adjust_quote_amount", {
    p_quote_id: fakeId,
    p_merchant_id: fakeId,
    p_new_amount: 1,
    p_from_status: "awaiting_review",
  });
  assert(
    adjust.error !== null &&
      /permission denied for function/i.test(adjust.error.message),
    `${label} 呼叫 adjust_quote_amount 應被 EXECUTE 權限擋下（實際：${adjust.error?.message ?? "未回錯誤"}）——若訊息是 permission denied for table/relation，代表 migration 0007 尚未套用`,
  );

  const rateLimit = await client.rpc("increment_rate_limit", {
    p_bucket_key: "verify-security-probe",
    p_window_start: new Date().toISOString(),
    p_limit: 1,
  });
  assert(
    rateLimit.error !== null &&
      /permission denied for function/i.test(rateLimit.error.message),
    `${label} 呼叫 increment_rate_limit 應被 EXECUTE 權限擋下（實際：${rateLimit.error?.message ?? "未回錯誤"}）——若訊息是 permission denied for table/relation，代表 migration 0007 尚未套用`,
  );

  console.log(`✅ ${label}：三個 RPC 皆回 permission denied for function`);
}

async function main(): Promise<void> {
  let merchant: TestMerchant | null = null;

  try {
    const anon = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    await assertExecuteDenied(anon, "未登入（anon）");

    merchant = await createTestMerchant();
    const authed = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    const { error: signInError } = await authed.auth.signInWithPassword({
      email: merchant.email,
      password: merchant.password,
    });
    if (signInError) {
      throw new Error(`測試商家登入失敗：${signInError.message}`);
    }
    await assertExecuteDenied(authed, "已登入商家（authenticated）");

    console.log(
      "\n🎉 migration 0007 驗收通過：PUBLIC EXECUTE 已收回，anon/authenticated 皆無法直接呼叫這三個 RPC。",
    );
  } finally {
    if (merchant) await cleanupTestMerchant(merchant);
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
