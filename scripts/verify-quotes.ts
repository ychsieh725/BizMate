/**
 * 驗證 5.6 後台報價查詢在真實 DB 上的租戶隔離（MT-M4a 驗收）。
 * 執行：pnpm verify:quotes
 *
 * 證明三件事：
 * 1. listQuotes(B) 只回 B 自己的報價——看不到 A 的。
 * 2. getQuoteDetail(A 的 quote, B 的 merchantId) 回 null（跨租戶取詳情失敗）。
 * 3. getQuoteDetail(A 的 quote, A 的 merchantId) 回完整脈絡（四張子表都撈到）。
 * 結束時無論成敗都清理測試資料（try/finally）。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import {
  listQuotes,
  getQuoteDetail,
} from "../src/domains/pricing/quoteReviewService.ts";
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

/**
 * 建立一個商家 + 一筆走完流程的報價（含四張子表各一列）。
 *
 * 建好 auth 使用者之後的每一步都可能失敗（CHECK 約束、FK…），一旦失敗
 * 本函式不會回傳 Fixture，呼叫端的 cleanup 也就無從清理——因此這裡自己
 * 兜底：後續步驟出錯就先刪掉剛建的使用者（merchants 對 auth.users 是
 * ON DELETE CASCADE，其餘列隨之而去）再往上拋，不留孤兒。
 */
async function createMerchantWithQuote(tag: string): Promise<Fixture> {
  const stamp = `${Date.now()}-${tag.toLowerCase()}`;
  const email = `verify-quotes-${stamp}@bizmate-test.local`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: "VerifyQuotesTest123",
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`建立測試使用者失敗：${userError?.message}`);
  }
  const merchantId = userData.user.id;

  try {
    // public_slug 的 CHECK 是 ^[a-z0-9][a-z0-9-]{2,31}$：只收小寫，且長度上限 32。
    const { error: merchantError } = await admin.from("merchants").insert({
      id: merchantId,
      display_name: `verify-quotes 商家 ${tag}`,
      public_slug: `verify-quotes-${stamp}`.slice(0, 32),
      contact_email: email,
    });
    if (merchantError) {
      throw new Error(`建立商家列失敗：${merchantError.message}`);
    }

    const { data: session, error: sessionError } = await admin
      .from("sessions")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        contact_email: `client-${tag}@example.com`,
        status: "awaiting_review",
      })
      .select()
      .single();
    if (sessionError || !session) {
      throw new Error(`建立 session 失敗：${sessionError?.message}`);
    }

    const subTableResults = await Promise.all([
      admin.from("raw_inputs").insert({
        session_id: session.id,
        raw_text: `${tag} 商家的客戶描述`,
      }),
      admin.from("extracted_fields").insert({
        session_id: session.id,
        field_name: "quantity",
        value: "3",
        confidence: 0.9,
        source_span: "三張",
      }),
      admin.from("clarification_turns").insert({
        session_id: session.id,
        round: 1,
        question: "請問授權範圍？",
        answer: "商用",
        triggered_field: "license_scope",
      }),
      admin.from("price_line_items").insert({
        session_id: session.id,
        item_name: "插畫基本費",
        amount: 6000,
      }),
    ]);
    const failed = subTableResults.find((result) => result.error !== null);
    if (failed?.error) {
      throw new Error(`建立子表資料失敗：${failed.error.message}`);
    }

    const { data: quote, error: quoteError } = await admin
      .from("quotes")
      .insert({
        session_id: session.id,
        merchant_id: merchantId,
        quote_code: `I-2607-${tag}`,
        final_amount: 6000,
        status: "awaiting_review",
      })
      .select()
      .single();
    if (quoteError || !quote) {
      throw new Error(`建立 quote 失敗：${quoteError?.message}`);
    }

    return { merchantId, sessionId: session.id, quoteId: quote.id };
  } catch (error) {
    await admin.auth.admin.deleteUser(merchantId).catch(() => {
      console.error(
        `⚠️ 建立 fixture 失敗後清理使用者也失敗，請至 Supabase Studio 手動刪除 ${merchantId}`,
      );
    });
    throw error;
  }
}

async function cleanup(fixture: Fixture | null): Promise<void> {
  if (fixture === null) return;
  await admin.from("quotes").delete().eq("id", fixture.quoteId);
  await admin.from("price_line_items").delete().eq("session_id", fixture.sessionId);
  await admin.from("clarification_turns").delete().eq("session_id", fixture.sessionId);
  await admin.from("extracted_fields").delete().eq("session_id", fixture.sessionId);
  await admin.from("raw_inputs").delete().eq("session_id", fixture.sessionId);
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
    console.log("✅ 建立 A / B 兩商家各一筆報價（含四張子表）完成");

    const listB = await listQuotes(merchantB.merchantId);
    assert(listB.length === 1, `B 的列表應只有 1 筆，實際 ${listB.length} 筆`);
    assert(
      listB[0].id === merchantB.quoteId,
      "B 的列表應只包含 B 自己的報價",
    );
    assert(
      listB[0].category === "illustration" && listB[0].contact_email !== null,
      "列表應帶出 session 的 category / contact_email",
    );
    console.log("✅ 列表只回自己的報價，且正確帶出 session 欄位");

    const filtered = await listQuotes(merchantB.merchantId, "sent");
    assert(filtered.length === 0, "B 沒有 sent 狀態的報價，過濾後應為空");
    console.log("✅ status 過濾生效");

    const crossTenant = await getQuoteDetail(
      merchantA.quoteId,
      merchantB.merchantId,
    );
    assert(crossTenant === null, "B 取 A 的報價詳情必須回 null（跨租戶隔離）");
    console.log("✅ 跨租戶取詳情被擋下（回 null → route 轉 404）");

    const owned = await getQuoteDetail(merchantA.quoteId, merchantA.merchantId);
    assert(owned !== null, "A 取自己的報價詳情應成功");
    assert(owned!.session.id === merchantA.sessionId, "詳情的 session 應為該報價的 session");
    assert(owned!.lineItems.length === 1, "應撈到 1 筆費用明細");
    assert(owned!.extractedFields.length === 1, "應撈到 1 筆抽取欄位");
    assert(owned!.clarifications.length === 1, "應撈到 1 輪澄清歷程");
    assert(owned!.rawInputs.length === 1, "應撈到 1 筆原始描述");
    console.log("✅ 本人取詳情成功，四張子表完整聚合");

    console.log("\n🎉 MT-M4a 報價查詢租戶隔離驗收通過。");
  } finally {
    await cleanup(merchantA);
    await cleanup(merchantB);
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
