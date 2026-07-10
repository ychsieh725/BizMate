/**
 * 驗證 migration 0004（rate_card_base 軟刪除）在真實 DB 上的行為（任務 5.5 驗收）。
 * 執行：pnpm verify:services
 *
 * 證明兩件事：
 * 1. 真實 DELETE 一個已被歷史報價引用的 rate_card_base 列會被 FK 擋下
 *    （NO ACTION）——這是軟刪除設計的必要性依據，不只是偏好。
 * 2. UPDATE is_active=false（軟刪除）不受此限制，且之後
 *    rateCardRepository.findBase 查無該列（basePricing 的 is_active
 *    過濾在真實 DB 上生效）。
 * 結束時無論成敗都清理測試資料（try/finally），且刻意先手動清掉
 * price_line_items/sessions 再刪使用者，不依賴跨表 cascade 順序假設。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import { rateCardRepository } from "../src/domains/pricing/repositories/rateCardRepository.ts";
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

async function main(): Promise<void> {
  let merchantId: string | null = null;
  let sessionId: string | null = null;

  try {
    const email = `verify-services-${Date.now()}@bizmate-test.local`;
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: "VerifyServicesTest123",
      email_confirm: true,
    });
    if (userError || !userData.user) {
      throw new Error(`建立測試使用者失敗：${userError?.message}`);
    }
    merchantId = userData.user.id;

    const { error: merchantError } = await admin.from("merchants").insert({
      id: merchantId,
      display_name: "verify-services 商家",
      public_slug: `verify-services-${Date.now()}`,
      contact_email: email,
    });
    if (merchantError) {
      throw new Error(`建立商家列失敗：${merchantError.message}`);
    }

    const { data: rateCard, error: rateCardError } = await admin
      .from("rate_card_base")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        subtype: "verify-services-subtype",
        unit: "件",
        base_price: 1000,
      })
      .select()
      .single();
    if (rateCardError || !rateCard) {
      throw new Error(`建立 rate_card_base 失敗：${rateCardError?.message}`);
    }
    assert(rateCard.is_active === true, "新建列預設 is_active 應為 true");
    console.log("✅ 建立測試商家與 rate_card_base 列完成");

    const { data: session, error: sessionError } = await admin
      .from("sessions")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        contact_email: email,
        status: "confirmed",
      })
      .select()
      .single();
    if (sessionError || !session) {
      throw new Error(`建立 session 失敗：${sessionError?.message}`);
    }
    sessionId = session.id;

    const { error: lineItemError } = await admin.from("price_line_items").insert({
      session_id: session.id,
      item_name: "verify-services 基本費",
      amount: 1000,
      rule_id: rateCard.id,
    });
    if (lineItemError) {
      throw new Error(`建立 price_line_items 失敗：${lineItemError.message}`);
    }
    console.log("✅ 建立引用該 rate_card_base 的歷史報價項目完成");

    const { error: deleteError } = await admin
      .from("rate_card_base")
      .delete()
      .eq("id", rateCard.id);
    assert(
      deleteError !== null && /foreign key|violates/i.test(deleteError.message),
      `真實 DELETE 應被外鍵約束擋下，實際：${deleteError?.message ?? "無錯誤"}`,
    );
    console.log("✅ 真實 DELETE 被外鍵約束擋下，證實軟刪除是必要設計");

    const { error: softDeleteError } = await admin
      .from("rate_card_base")
      .update({ is_active: false })
      .eq("id", rateCard.id);
    assert(
      softDeleteError === null,
      `軟刪除（UPDATE is_active=false）應成功：${softDeleteError?.message}`,
    );
    console.log("✅ 軟刪除成功，歷史報價引用未受影響");

    const found = await rateCardRepository.findBase(
      merchantId,
      "illustration",
      "verify-services-subtype",
    );
    assert(
      found === null,
      "軟刪除後 rateCardRepository.findBase 應查無結果（is_active 過濾生效）",
    );
    console.log("✅ basePricing 查詢已排除停售項目");

    console.log("\n🎉 MT-M3 軟刪除設計驗收通過。");
  } finally {
    if (sessionId) {
      await admin.from("price_line_items").delete().eq("session_id", sessionId);
      await admin.from("sessions").delete().eq("id", sessionId);
    }
    if (merchantId) {
      await admin.auth.admin.deleteUser(merchantId).catch(() => {
        console.error(
          `⚠️ 清理測試商家失敗，請至 Supabase Studio 手動刪除 ${merchantId}`,
        );
      });
    }
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
