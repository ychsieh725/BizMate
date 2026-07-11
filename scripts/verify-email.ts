/**
 * 驗證 5.8 MT-M5 的 Email 寄送在真實環境上的行為（真實 DB + 真實 Resend API）。
 * 執行：pnpm verify:email
 *
 * ⚠️ 這是唯一一支會真的寄出 Email 的 verify script。執行前必須在 .env.local
 * 設定 VERIFY_EMAIL_RECIPIENT 為一個你能實際收信的信箱——腳本結束後請自行
 * 打開該信箱，人工確認主旨/內文/寄件者/回覆地址是否正確（這件事無法自動化）。
 *
 * 證明三件事：
 * 1. confirmed 狀態下呼叫 sendQuoteEmail 成功，quotes.status/sessions.status
 *    原子同步為 sent，且 sent_at 已寫入。
 * 2. 跨租戶（B 的 merchantId 呼叫 A 的報價）→ not_found。
 * 3. 重複呼叫（已是 sent）→ conflict，不會二次觸發 Resend API。
 * 結束時無論成敗都清理測試資料（try/finally）。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import { sendQuoteEmail } from "../src/domains/pricing/quoteActionsService.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`驗證失敗：${message}`);
  }
}

const recipient = process.env.VERIFY_EMAIL_RECIPIENT;
if (!recipient) {
  console.error(
    "請在 .env.local 設定 VERIFY_EMAIL_RECIPIENT=你的真實信箱後再執行本腳本，" +
      "此腳本會實際寄出一封 Email 供人工確認收件內容。",
  );
  process.exit(1);
}

const admin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

type Fixture = { merchantId: string; sessionId: string; quoteId: string };

async function createConfirmedQuote(tag: string, contactEmail: string): Promise<Fixture> {
  const stamp = `${Date.now()}-${tag.toLowerCase()}`;
  const email = `verify-email-${stamp}@bizmate-test.local`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: "VerifyEmailTest123",
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`建立測試使用者失敗：${userError?.message}`);
  }
  const merchantId = userData.user.id;

  try {
    const { error: merchantError } = await admin.from("merchants").insert({
      id: merchantId,
      display_name: `verify-email 商家 ${tag}`,
      public_slug: `verify-email-${stamp}`.slice(0, 32),
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
        contact_email: contactEmail,
        status: "confirmed",
      })
      .select()
      .single();
    if (sessionError || !session) {
      throw new Error(`建立 session 失敗：${sessionError?.message}`);
    }

    const { error: lineItemError } = await admin.from("price_line_items").insert({
      session_id: session.id,
      item_name: "插畫基本費",
      amount: 6000,
    });
    if (lineItemError) {
      throw new Error(`建立 price_line_items 失敗：${lineItemError.message}`);
    }

    const { data: quote, error: quoteError } = await admin
      .from("quotes")
      .insert({
        session_id: session.id,
        merchant_id: merchantId,
        quote_code: `I-2607-${tag}`,
        final_amount: 6000,
        status: "confirmed",
      })
      .select()
      .single();
    if (quoteError || !quote) {
      throw new Error(`建立 quote 失敗：${quoteError?.message}`);
    }

    return { merchantId, sessionId: session.id, quoteId: quote.id };
  } catch (error) {
    await admin.auth.admin.deleteUser(merchantId).catch(() => {});
    throw error;
  }
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
    merchantA = await createConfirmedQuote("A", recipient!);
    merchantB = await createConfirmedQuote("B", recipient!);
    console.log("✅ 建立 A / B 兩商家各一筆 confirmed 報價完成");

    const crossTenant = await sendQuoteEmail({
      quoteId: merchantA.quoteId,
      merchantId: merchantB.merchantId,
    });
    assert(
      !crossTenant.ok && crossTenant.reason === "not_found",
      "B 寄 A 的報價必須回 not_found",
    );
    console.log("✅ 跨租戶寄送被擋下");

    const sent = await sendQuoteEmail({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
    });
    assert(sent.ok, `寄送應成功：${!sent.ok ? JSON.stringify(sent) : ""}`);
    assert(sent.ok && sent.quote.status === "sent", "quotes.status 應為 sent");
    console.log(`✅ Email 已實際寄出至 ${recipient}，請打開該信箱人工確認內容`);

    const { data: session } = await admin
      .from("sessions")
      .select("status")
      .eq("id", merchantA.sessionId)
      .single();
    assert(
      session?.status === "sent",
      `sessions.status 應同步為 sent，實際：${session?.status}`,
    );

    const { data: quoteRow } = await admin
      .from("quotes")
      .select("sent_at")
      .eq("id", merchantA.quoteId)
      .single();
    assert(quoteRow?.sent_at !== null, "sent_at 應已寫入");
    console.log("✅ quotes.status/sessions.status 原子同步為 sent，sent_at 已寫入");

    const resend = await sendQuoteEmail({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
    });
    assert(
      !resend.ok && resend.reason === "conflict",
      "已是 sent 的報價重複寄送必須回 conflict（不再觸發第二次外部寄信）",
    );
    console.log("✅ 重複寄送被擋下，不會二次觸發 Resend API");

    console.log(
      "\n🎉 MT-M5 Email 寄送驗收通過。請務必人工檢查收件匣確認內容正確。",
    );
  } finally {
    await cleanup(merchantA);
    await cleanup(merchantB);
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
