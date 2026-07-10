/**
 * 驗證 RLS owner policy 是否生效（任務 5.4 驗收）。
 * 執行：pnpm verify:auth
 *
 * 建兩個獨立測試商家 A、B，各自建立 rate_card_base 資料；
 * 用 A 的真實 JWT + anon key（非 service_role）直查 rate_card_base，
 * 證明只回 A 的列、查不到 B 的列——這是 RLS 第二道防線的直接證據。
 * 結束時無論成敗都清理兩個測試帳號（try/finally）。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`驗證失敗：${message}`);
  }
}

type TestMerchant = { userId: string; email: string; password: string };

const admin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function createTestMerchant(label: string): Promise<TestMerchant> {
  const email = `verify-auth-${label}-${Date.now()}@bizmate-test.local`;
  const password = "VerifyAuthTest123";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`建立測試商家 ${label} 失敗：${error?.message}`);
  }

  const { error: merchantError } = await admin.from("merchants").insert({
    id: data.user.id,
    display_name: `驗證商家 ${label}`,
    public_slug: `verify-auth-${label}-${Date.now()}`,
    contact_email: email,
  });
  if (merchantError) {
    throw new Error(`建立商家列 ${label} 失敗：${merchantError.message}`);
  }

  const { error: rateCardError } = await admin.from("rate_card_base").insert({
    merchant_id: data.user.id,
    category: "illustration",
    subtype: "verify-auth-subtype",
    unit: "件",
    base_price: 1000,
  });
  if (rateCardError) {
    throw new Error(`建立價目表 ${label} 失敗：${rateCardError.message}`);
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

async function main(): Promise<void> {
  let merchantA: TestMerchant | null = null;
  let merchantB: TestMerchant | null = null;

  try {
    merchantA = await createTestMerchant("a");
    merchantB = await createTestMerchant("b");
    console.log("✅ 建立測試商家 A、B 完成");

    const anon = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    const { data: signInData, error: signInError } =
      await anon.auth.signInWithPassword({
        email: merchantA.email,
        password: merchantA.password,
      });
    if (signInError || !signInData.session) {
      throw new Error(`商家 A 登入失敗：${signInError?.message}`);
    }
    console.log("✅ 商家 A 登入取得 JWT");

    const { data: rows, error: queryError } = await anon
      .from("rate_card_base")
      .select("*");
    if (queryError) {
      throw new Error(`直查 rate_card_base 失敗：${queryError.message}`);
    }

    assert(
      rows !== null && rows.length > 0,
      "應查到至少一列（商家 A 自己的資料）",
    );
    assert(
      rows!.every((row) => row.merchant_id === merchantA!.userId),
      "查到的列必須全部屬於商家 A，不可含商家 B 的資料",
    );
    assert(
      !rows!.some((row) => row.merchant_id === merchantB!.userId),
      "不可查到商家 B 的列（RLS 隔離失效）",
    );
    console.log(`✅ RLS 隔離驗證通過：只查到商家 A 自己的 ${rows!.length} 列`);

    console.log("\n🎉 RLS owner policy 驗收通過（第二道防線有效）。");
  } finally {
    if (merchantA) await cleanupTestMerchant(merchantA);
    if (merchantB) await cleanupTestMerchant(merchantB);
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
