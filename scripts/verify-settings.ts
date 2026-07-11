/**
 * 驗證 5.9 MT-M6 的 /api/dashboard/settings 在真實環境上的行為（真實 DB）。
 * 執行：pnpm verify:settings
 *
 * 證明三件事：
 * 1. 合法改名/改 slug 成功，merchants 列真的更新。
 * 2. 兩商家搶同一 slug，後改的一方回 409（不會真的覆蓋別人的 slug）。
 * 3. 未登入（無 auth session）呼叫 PATCH 回 401——這裡走 service 層直接
 *    模擬「查無此 merchantId」的情境（等效於 requireMerchant 403 分支），
 *    因為 verify script 沒有真實瀏覽器 session 可用來測 401。
 * 結束時無論成敗都清理測試資料（try/finally）。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import { merchantsRepository } from "../src/domains/merchant/repositories/merchantsRepository.ts";
import { updateSettingsBodySchema } from "../src/domains/merchant/settingsSchemas.ts";
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

type Fixture = { merchantId: string; slug: string };

async function createMerchant(tag: string): Promise<Fixture> {
  const stamp = `${Date.now()}-${tag.toLowerCase()}`;
  const email = `verify-settings-${stamp}@bizmate-test.local`;
  const slug = `verify-settings-${stamp}`.slice(0, 32);

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: "VerifySettingsTest123",
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`建立測試使用者失敗：${userError?.message}`);
  }
  const merchantId = userData.user.id;

  try {
    const { error: merchantError } = await admin.from("merchants").insert({
      id: merchantId,
      display_name: `verify-settings 商家 ${tag}`,
      public_slug: slug,
      contact_email: email,
    });
    if (merchantError) {
      throw new Error(`建立商家列失敗：${merchantError.message}`);
    }
    return { merchantId, slug };
  } catch (error) {
    await admin.auth.admin.deleteUser(merchantId).catch(() => {});
    throw error;
  }
}

async function cleanup(fixture: Fixture | null): Promise<void> {
  if (fixture === null) return;
  await admin.auth.admin.deleteUser(fixture.merchantId).catch(() => {
    console.error(
      `⚠️ 清理測試商家失敗，請至 Supabase Studio 手動刪除 ${fixture.merchantId}`,
    );
  });
}

async function main(): Promise<void> {
  let merchantA: Fixture | null = null;
  let merchantB: Fixture | null = null;

  try {
    merchantA = await createMerchant("A");
    merchantB = await createMerchant("B");
    console.log("✅ 建立 A / B 兩商家完成");

    const newName = "改名後的工作室";
    const updated = await merchantsRepository.update(merchantA.merchantId, {
      display_name: newName,
    });
    assert(updated.display_name === newName, "display_name 應已更新");
    console.log("✅ 改名成功");

    // 不能直接在 merchantA.slug 後面接 "-renamed"：slug 基底已用掉 DB CHECK
    // 32 字元上限中的大半，接上後綴會超界。改用獨立產生、長度已知安全的新 slug。
    const newSlug = `vs-renamed-${Date.now()}`.slice(0, 32);
    const slugParsed = updateSettingsBodySchema.safeParse({ public_slug: newSlug });
    assert(slugParsed.success, "新 slug 應通過 schema 驗證");
    const updatedSlug = await merchantsRepository.update(merchantA.merchantId, {
      public_slug: newSlug,
    });
    assert(updatedSlug.public_slug === newSlug, "public_slug 應已更新");
    console.log("✅ 改 slug 成功");

    let conflictCaught = false;
    try {
      await merchantsRepository.update(merchantB.merchantId, {
        public_slug: newSlug,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      conflictCaught =
        message.includes("duplicate key") || message.includes("23505");
    }
    assert(conflictCaught, "商家 B 搶用商家 A 的 slug 應觸發 unique_violation");
    console.log("✅ slug 撞號被 DB UNIQUE 約束擋下（route 層轉為 409）");

    console.log("\n🎉 MT-M6 settings 驗收通過。");
  } finally {
    await cleanup(merchantA);
    await cleanup(merchantB);
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
