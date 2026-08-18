/**
 * 驗證調價 diff 品質指標的兩個 view（WBS 6.4 驗收）。
 * 執行：pnpm verify:adjustment-metrics
 *
 * 這支腳本要證明三件 mock 測試證明不了的事：
 *
 * 1. **數字算對** — 建一張已知金額的報價、用真實的 adjust_quote_amount RPC
 *    調價，然後檢查 view 算出的 ai_amount 與 adjustment_ratio。手動調整列的
 *    識別條件（rule_id 與 modifier_id 皆為 NULL）散落在 RPC 與 view 兩處，
 *    只有實跑才驗得到它們是否一致。
 *
 * 2. **分母正確** — awaiting_review 的報價不該進 view。商家還沒看過的報價
 *    算成「未調整」會系統性低估調整率，本專案在端到端成功率上已犯過一次
 *    同樣的錯。
 *
 * 3. **RLS 沒有被 view 繞過** — 這是最重要的一項。view 預設以定義者權限
 *    執行，會直接穿透底層表的 RLS。security_invoker = true 是唯一的防線，
 *    而它寫錯不會有任何錯誤訊息，只會讓所有商家的報價金額對彼此可見。
 *    故此處用 B 商家的真實 JWT 查 view，證明看不到 A 的資料。
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

const PASSWORD = "VerifyAdjMetrics123";
/** AI 算出的金額；用整數方便核對比率。 */
const AI_AMOUNT = 10000;
/** 商家調整後的金額，等於 AI 高估 20%（差額 -2000）。 */
const ADJUSTED_AMOUNT = 8000;

async function createTestMerchant(label: string): Promise<TestMerchant> {
  const email = `verify-adjmetrics-${label}-${Date.now()}@bizmate-test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`建立測試商家 ${label} 失敗：${error?.message}`);
  }

  const { error: merchantError } = await admin.from("merchants").insert({
    id: data.user.id,
    display_name: `調價指標測試 ${label}`,
    // slug 受 ^[a-z0-9][a-z0-9-]{2,31}$ 約束（最長 32 字元），
    // 完整時間戳會超長，取後 8 碼即足以避免同一秒內的碰撞。
    public_slug: `vadj-${label}-${Date.now().toString().slice(-8)}`,
    contact_email: email,
  });
  if (merchantError) {
    throw new Error(`建立 merchant ${label} 失敗：${merchantError.message}`);
  }

  return { userId: data.user.id, email, password: PASSWORD };
}

/**
 * 建一列費率供測試用的明細引用。
 *
 * 每個商家只建一次：rate_card_base 有 UNIQUE (merchant_id, category, subtype)，
 * 每張報價各插一次會在第二張失敗，導致明細的 rule_id 為 NULL，而那正是 view
 * 判定「手動調整列」的條件——基礎明細會被誤算成調價。
 *
 * 這不只是測試寫法問題：view 的識別條件依賴「計價產出的明細必帶 rule_id」，
 * 該前提由 0005 的註解記載並由 basePricing 保證。若日後出現兩者皆 NULL 的
 * 新明細類型，這個 view 與 adjust_quote_amount 都會誤判。
 */
async function createRateCardRule(merchantId: string): Promise<string> {
  const { data, error } = await admin
    .from("rate_card_base")
    .insert({
      merchant_id: merchantId,
      category: "graphic_design",
      subtype: "驗證用項目",
      unit: "每款",
      base_price: AI_AMOUNT,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`建立測試費率失敗：${error?.message}`);
  }
  return data.id;
}

/** 建一張報價並推進到指定狀態；回傳 quote 與 session id。 */
async function createQuote(
  merchantId: string,
  ruleId: string,
  status: "awaiting_review" | "confirmed",
): Promise<{ quoteId: string; sessionId: string }> {
  const { data: session, error: sessionError } = await admin
    .from("sessions")
    .insert({
      merchant_id: merchantId,
      category: "graphic_design",
      status: "awaiting_review",
      current_step: 4,
    })
    .select("id")
    .single();
  if (sessionError || !session) {
    throw new Error(`建立 session 失敗：${sessionError?.message}`);
  }

  // 基礎明細必帶 rule_id，否則會被 view 判定為手動調整列（見 createRateCardRule）。
  const { error: itemError } = await admin.from("price_line_items").insert({
    session_id: session.id,
    item_name: "基礎費率",
    amount: AI_AMOUNT,
    rule_id: ruleId,
  });
  if (itemError) {
    throw new Error(`建立明細失敗：${itemError.message}`);
  }

  const { data: quote, error: quoteError } = await admin
    .from("quotes")
    .insert({
      session_id: session.id,
      merchant_id: merchantId,
      quote_code: `V-${Date.now().toString().slice(-8)}`,
      final_amount: AI_AMOUNT,
      status,
    })
    .select("id")
    .single();
  if (quoteError || !quote) {
    throw new Error(`建立 quote 失敗：${quoteError?.message}`);
  }

  return { quoteId: quote.id, sessionId: session.id };
}

async function cleanup(merchant: TestMerchant | null): Promise<void> {
  if (merchant === null) return;
  // merchants 與 auth user 皆為 CASCADE 根，刪帳號即連帶清除所有測試資料。
  await admin.auth.admin.deleteUser(merchant.userId);
}

async function main(): Promise<void> {
  let merchantA: TestMerchant | null = null;
  let merchantB: TestMerchant | null = null;

  try {
    console.log("調價指標驗證｜WBS 6.4\n");

    merchantA = await createTestMerchant("a");
    merchantB = await createTestMerchant("b");
    console.log(`✓ 建立測試商家 A（${merchantA.userId}）與 B`);

    // ── 1. 已調價的 confirmed 報價 ──
    const ruleId = await createRateCardRule(merchantA.userId);
    const adjusted = await createQuote(merchantA.userId, ruleId, "confirmed");
    const { data: rpcOk, error: rpcError } = await admin.rpc(
      "adjust_quote_amount",
      {
        p_quote_id: adjusted.quoteId,
        p_merchant_id: merchantA.userId,
        p_new_amount: ADJUSTED_AMOUNT,
        p_from_status: "confirmed",
      },
    );
    if (rpcError) {
      throw new Error(`adjust_quote_amount 失敗：${rpcError.message}`);
    }
    assert(rpcOk === true, "adjust_quote_amount 應回 true");
    console.log(`✓ 已調價：${AI_AMOUNT} → ${ADJUSTED_AMOUNT}`);

    // ── 2. 未調價的 confirmed 報價 ──
    await createQuote(merchantA.userId, ruleId, "confirmed");

    // ── 3. 尚未審核的報價（不該進 view）──
    await createQuote(merchantA.userId, ruleId, "awaiting_review");
    console.log("✓ 另建未調價與未審核各一張");

    // ── 驗證 facts view 的計算 ──
    const { data: facts, error: factsError } = await admin
      .from("quote_adjustment_facts")
      .select("*")
      .eq("merchant_id", merchantA.userId);
    if (factsError) {
      throw new Error(`查 quote_adjustment_facts 失敗：${factsError.message}`);
    }

    assert(
      facts!.length === 2,
      `view 應只含 2 張已決定的報價（awaiting_review 須排除），實得 ${facts!.length}`,
    );

    const adjustedRow = facts!.find((row) => row.quote_id === adjusted.quoteId);
    assert(adjustedRow !== undefined, "調價後的報價應出現在 view");
    assert(
      Number(adjustedRow!.final_amount) === ADJUSTED_AMOUNT,
      `final_amount 應為 ${ADJUSTED_AMOUNT}，實得 ${adjustedRow!.final_amount}`,
    );
    assert(
      Number(adjustedRow!.ai_amount) === AI_AMOUNT,
      `ai_amount 應還原為 ${AI_AMOUNT}，實得 ${adjustedRow!.ai_amount}`,
    );
    assert(
      Number(adjustedRow!.adjustment_amount) === ADJUSTED_AMOUNT - AI_AMOUNT,
      `adjustment_amount 應為 ${ADJUSTED_AMOUNT - AI_AMOUNT}，實得 ${adjustedRow!.adjustment_amount}`,
    );
    assert(
      Math.abs(Number(adjustedRow!.adjustment_ratio) + 0.2) < 1e-9,
      `adjustment_ratio 應為 -0.2（AI 高估 20%），實得 ${adjustedRow!.adjustment_ratio}`,
    );
    assert(adjustedRow!.was_adjusted === true, "was_adjusted 應為 true");
    console.log("✓ 已調價報價：ai_amount 還原正確、調幅 -20%");

    const untouched = facts!.find((row) => row.quote_id !== adjusted.quoteId);
    assert(untouched!.was_adjusted === false, "未調價報價的 was_adjusted 應為 false");
    assert(
      Number(untouched!.adjustment_amount) === 0,
      "未調價報價的 adjustment_amount 應為 0",
    );
    console.log("✓ 未調價報價：正確標記為未調整");

    // ── 驗證月聚合 ──
    const { data: monthly, error: monthlyError } = await admin
      .from("quote_adjustment_monthly")
      .select("*")
      .eq("merchant_id", merchantA.userId);
    if (monthlyError) {
      throw new Error(`查 quote_adjustment_monthly 失敗：${monthlyError.message}`);
    }
    assert(monthly!.length === 1, `應聚合成 1 列，實得 ${monthly!.length}`);
    assert(
      Number(monthly![0].decided_quotes) === 2,
      `decided_quotes 應為 2，實得 ${monthly![0].decided_quotes}`,
    );
    assert(
      Math.abs(Number(monthly![0].adjustment_rate) - 0.5) < 1e-9,
      `adjustment_rate 應為 0.5，實得 ${monthly![0].adjustment_rate}`,
    );
    assert(
      Math.abs(Number(monthly![0].avg_abs_adjustment_ratio) - 0.2) < 1e-9,
      `avg_abs_adjustment_ratio 應為 0.2（只平均有調整的那張），實得 ${monthly![0].avg_abs_adjustment_ratio}`,
    );
    console.log("✓ 月聚合：調整率 50%、平均調幅 20%");

    // ── view 不對瀏覽器開放（fail closed）──
    //
    // 這個 view join 了 price_line_items，而 0003 只把 SELECT 開給
    // merchants / quotes / sessions / rate_card_*。故 authenticated 查它必然
    // 被權限層擋下，這正是預期行為：後台一律以 service_role 在伺服器端查詢並
    // 於應用層帶 merchant_id 過濾。
    //
    // **這一段測不到 security_invoker 本身。** 權限層先擋下來了，RLS 根本沒有
    // 機會運作。security_invoker 是為了「哪天有人開了 price_line_items 的讀取
    // 權」那一刻而存在的第二道防線，在那之前無法從外部驗證。此處誠實記錄這個
    // 限制，而不是讓一個因權限被擋而通過的斷言假裝自己驗證了 RLS。
    const anonB = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } },
    );
    const { error: signInError } = await anonB.auth.signInWithPassword({
      email: merchantB.email,
      password: merchantB.password,
    });
    if (signInError) {
      throw new Error(`商家 B 登入失敗：${signInError.message}`);
    }

    const { data: leaked, error: leakError } = await anonB
      .from("quote_adjustment_facts")
      .select("quote_id, merchant_id, final_amount");

    assert(
      leakError !== null || (leaked ?? []).length === 0,
      `商家 B 不該讀到任何列，實得 ${leaked?.length ?? 0} 列`,
    );
    console.log(
      leakError === null
        ? "✓ 商家 B 查 view 回 0 列"
        : `✓ 商家 B 查 view 被權限層擋下（fail closed）：${leakError.message}`,
    );

    // service_role 查得到，但可見範圍由應用層的 merchant_id 過濾負責。
    // 這是後台實際走的路徑，故一併驗證它確實只回該商家的列。
    const { data: bFacts } = await admin
      .from("quote_adjustment_facts")
      .select("quote_id")
      .eq("merchant_id", merchantB.userId);
    assert(
      (bFacts ?? []).length === 0,
      `商家 B 沒有任何報價，依 merchant_id 過濾應回 0 列，實得 ${bFacts?.length ?? 0}`,
    );
    console.log("✓ service_role 依 merchant_id 過濾：商家 B 回 0 列");

    console.log("\n🎉 全部通過。");
  } finally {
    await cleanup(merchantA);
    await cleanup(merchantB);
    console.log("已清理測試資料。");
  }
}

main().catch((error: unknown) => {
  console.error("\n驗證失敗：", error);
  process.exit(1);
});
