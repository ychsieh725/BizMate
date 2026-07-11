/**
 * 驗證 migration 0005 的兩個原子 RPC 在真實 DB 上的行為（5.7 MT-M4b 驗收）。
 * 執行：pnpm verify:quote-actions
 *
 * 證明五件事：
 * 1. 調金額後 sum(price_line_items) == quotes.final_amount（不變式成立）。
 * 2. 重複調金額不累積多筆「手動調整」列（先刪再插）。
 * 3. 確認後 quotes.status 與 sessions.status 同步推進為 confirmed（原子）。
 * 4. 重複確認回 FALSE（CAS 擋下；併發下的第二個呼叫者）。
 * 5. 跨租戶：以 B 的 merchantId 呼叫 RPC 動 A 的報價 → FALSE 且資料不變。
 * 結束時無論成敗都清理測試資料（try/finally）。
 *
 * 前提：migration 0005 已套用至 Supabase。未套用會以
 * 「function ... does not exist」失敗——這是預期的守門機制。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import {
  adjustQuoteAmount,
  confirmQuote,
} from "../src/domains/pricing/quoteActionsService.ts";
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

type Fixture = { merchantId: string; sessionId: string; quoteId: string };

/** 建立一個商家 + 一筆待審報價（兩筆明細，加總 8000）。 */
async function createMerchantWithQuote(tag: string): Promise<Fixture> {
  const stamp = `${Date.now()}-${tag.toLowerCase()}`;
  const email = `verify-actions-${stamp}@bizmate-test.local`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: "VerifyActionsTest123",
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`建立測試使用者失敗：${userError?.message}`);
  }
  const merchantId = userData.user.id;

  try {
    const { error: merchantError } = await admin.from("merchants").insert({
      id: merchantId,
      display_name: `verify-actions 商家 ${tag}`,
      // public_slug 只收小寫（0001 的 CHECK 約束）。
      public_slug: `verify-actions-${stamp}`.slice(0, 32),
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
        subtype: `verify-actions-${tag.toLowerCase()}`,
        unit: "件",
        base_price: 6000,
      })
      .select()
      .single();
    if (rateCardError || !rateCard) {
      throw new Error(`建立 rate_card_base 失敗：${rateCardError?.message}`);
    }

    const { data: session, error: sessionError } = await admin
      .from("sessions")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        contact_email: `client-${tag.toLowerCase()}@example.com`,
        status: "awaiting_review",
      })
      .select()
      .single();
    if (sessionError || !session) {
      throw new Error(`建立 session 失敗：${sessionError?.message}`);
    }

    // 兩筆明細，加總 8000：基礎費帶 rule_id、加成帶 modifier_id ——
    // 兩者皆非「手動調整」列（rule_id 與 modifier_id 皆 NULL），不該被 RPC 刪掉。
    const { data: modifier, error: modifierError } = await admin
      .from("rate_card_modifiers")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        modifier_name: `verify-actions-${tag.toLowerCase()}`,
        trigger_condition: "急件",
        range_min: 0.2,
        range_max: 0.5,
      })
      .select()
      .single();
    if (modifierError || !modifier) {
      throw new Error(`建立 rate_card_modifiers 失敗：${modifierError?.message}`);
    }

    const { error: lineItemsError } = await admin.from("price_line_items").insert([
      {
        session_id: session.id,
        item_name: "插畫基本費",
        amount: 6000,
        rule_id: rateCard.id,
      },
      {
        session_id: session.id,
        item_name: "急件加成",
        amount: 2000,
        modifier_id: modifier.id,
      },
    ]);
    if (lineItemsError) {
      throw new Error(`建立 price_line_items 失敗：${lineItemsError.message}`);
    }

    const { data: quote, error: quoteError } = await admin
      .from("quotes")
      .insert({
        session_id: session.id,
        merchant_id: merchantId,
        quote_code: `I-2607-${tag}`,
        final_amount: 8000,
        status: "awaiting_review",
      })
      .select()
      .single();
    if (quoteError || !quote) {
      throw new Error(`建立 quote 失敗：${quoteError?.message}`);
    }

    return { merchantId, sessionId: session.id, quoteId: quote.id };
  } catch (error) {
    // fixture 建到一半失敗 → 先刪 auth 使用者（merchants 對其 ON DELETE CASCADE），
    // 不留孤兒帳號。
    await admin.auth.admin.deleteUser(merchantId).catch(() => {});
    throw error;
  }
}

/** 該 session 的明細加總。 */
async function sumLineItems(sessionId: string): Promise<number> {
  const { data, error } = await admin
    .from("price_line_items")
    .select("amount")
    .eq("session_id", sessionId);
  if (error) {
    throw new Error(`查詢明細失敗：${error.message}`);
  }
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
}

/** 該 session 的「手動調整」列數（rule_id 與 modifier_id 皆 NULL）。 */
async function countAdjustmentRows(sessionId: string): Promise<number> {
  const { count, error } = await admin
    .from("price_line_items")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .is("rule_id", null)
    .is("modifier_id", null);
  if (error) {
    throw new Error(`查詢調整列失敗：${error.message}`);
  }
  return count ?? 0;
}

async function cleanup(fixture: Fixture | null): Promise<void> {
  if (fixture === null) return;
  await admin.from("quotes").delete().eq("id", fixture.quoteId);
  await admin.from("price_line_items").delete().eq("session_id", fixture.sessionId);
  await admin.from("sessions").delete().eq("id", fixture.sessionId);
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
    merchantA = await createMerchantWithQuote("A");
    merchantB = await createMerchantWithQuote("B");
    console.log("✅ 建立 A / B 兩商家各一筆待審報價（明細加總 8000）完成");

    // ① 調金額 → 不變式成立
    const adjusted = await adjustQuoteAmount({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
      finalAmount: 9000,
    });
    assert(adjusted.ok, "A 調整自己的報價金額應成功");
    assert(
      adjusted.ok && Number(adjusted.quote.final_amount) === 9000,
      "final_amount 應更新為 9000",
    );
    assert(
      (await sumLineItems(merchantA.sessionId)) === 9000,
      "明細加總應等於 final_amount（9000）",
    );
    assert(
      (await countAdjustmentRows(merchantA.sessionId)) === 1,
      "應插入 1 筆手動調整列（差額 +1000）",
    );
    console.log("✅ 調金額後 sum(line_items) == final_amount，調整列 1 筆");

    // ② 重複調金額 → 不累積調整列
    const readjusted = await adjustQuoteAmount({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
      finalAmount: 7000,
    });
    assert(readjusted.ok, "再次調整金額應成功");
    assert(
      (await sumLineItems(merchantA.sessionId)) === 7000,
      "重調後明細加總應等於 7000",
    );
    assert(
      (await countAdjustmentRows(merchantA.sessionId)) === 1,
      "重複調整不應累積多筆調整列（先刪再插）",
    );
    console.log("✅ 重複調金額不累積調整列，不變式維持");

    // ③ 跨租戶：B 動 A 的報價
    const crossAdjust = await adjustQuoteAmount({
      quoteId: merchantA.quoteId,
      merchantId: merchantB.merchantId,
      finalAmount: 99999,
    });
    assert(
      !crossAdjust.ok && crossAdjust.reason === "not_found",
      "B 調 A 的報價金額必須回 not_found",
    );
    assert(
      (await sumLineItems(merchantA.sessionId)) === 7000,
      "跨租戶調整失敗後，A 的資料不得被改動",
    );

    const crossConfirm = await confirmQuote({
      quoteId: merchantA.quoteId,
      merchantId: merchantB.merchantId,
    });
    assert(
      !crossConfirm.ok && crossConfirm.reason === "not_found",
      "B 確認 A 的報價必須回 not_found",
    );
    console.log("✅ 跨租戶調金額/確認皆被擋下，且資料未被改動");

    // ④ 確認 → 兩個 status 同步推進
    const confirmed = await confirmQuote({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
    });
    assert(confirmed.ok, "A 確認自己的報價應成功");
    assert(
      confirmed.ok && confirmed.quote.status === "confirmed",
      "quotes.status 應為 confirmed",
    );

    const { data: session } = await admin
      .from("sessions")
      .select("status")
      .eq("id", merchantA.sessionId)
      .single();
    assert(
      session?.status === "confirmed",
      `sessions.status 應同步為 confirmed，實際：${session?.status}`,
    );
    console.log("✅ 確認後 quotes.status 與 sessions.status 原子同步為 confirmed");

    // ⑤ 重複確認 → CAS 擋下
    const reconfirm = await confirmQuote({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
    });
    assert(
      !reconfirm.ok && reconfirm.reason === "conflict",
      "重複確認必須回 conflict（狀態機不接受 / CAS 擋下）",
    );

    // 已確認的報價不可再調金額
    const adjustAfterConfirm = await adjustQuoteAmount({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
      finalAmount: 5000,
    });
    assert(
      !adjustAfterConfirm.ok && adjustAfterConfirm.reason === "conflict",
      "已確認的報價不可再調金額",
    );
    assert(
      (await sumLineItems(merchantA.sessionId)) === 7000,
      "確認後的報價金額不得被改動",
    );
    console.log("✅ 重複確認與確認後調金額皆被擋下，資料未被改動");

    console.log("\n🎉 MT-M4b 原子 RPC 與租戶隔離驗收通過。");
  } finally {
    await cleanup(merchantA);
    await cleanup(merchantB);
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
