import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { E2E_ENV } from "./env";

/**
 * E2E 測試資料的 service_role 管理層。
 *
 * 刻意不 import 專案 src（避免 `@/` alias + `.ts` 副檔名解析與 Playwright loader
 * 打架），直接建自己的 admin client，做法對齊 scripts/verify-*.ts。
 * service_role 會繞過 RLS，僅用於「預備測試前置」與「測試後清理」，不代表被測邏輯。
 */

export type ProvisionedUser = {
  userId: string;
  email: string;
  password: string;
};

export type QuoteRow = {
  id: string;
  /** 軌跡等子表都掛在 session 下，A7 的 E2E 需要它來 seed。 */
  session_id: string;
  quote_code: string;
  status: string;
  final_amount: number | null;
  sent_at: string | null;
};

export type RateCardRow = {
  id: string;
  category: string;
  subtype: string;
  base_price: number | null;
};

function createAdmin(): SupabaseClient {
  return createClient(E2E_ENV.supabaseUrl, E2E_ENV.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const admin = createAdmin();

/**
 * 建一個「已確認 email」的測試登入帳號，但刻意不建 merchant 列——
 * 讓被測的 UI 走真正的 /onboarding 建商家，涵蓋 onboarding 這一步。
 */
export async function provisionConfirmedUser(
  tag: string,
): Promise<ProvisionedUser> {
  const email = `e2e-${tag}-${Date.now()}@bizmate-test.local`;
  const password = "E2eCriticalPath123";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`建立測試登入帳號失敗：${error?.message}`);
  }
  return { userId: data.user.id, email, password };
}

/** 依 email 找回 auth user id（signup 走公開流程時沒有預先拿到 id）。 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  // dev 專案使用者量小，單頁即可；量大時再加分頁。
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    throw new Error(`查詢 auth users 失敗：${error.message}`);
  }
  const found = data.users.find((user) => user.email === email);
  return found?.id ?? null;
}

/** 讀 onboarding 後自動產生的 merchant slug（匿名客戶要用它跑 /q/{slug}）。 */
export async function getMerchantSlug(userId: string): Promise<string> {
  const { data, error } = await admin
    .from("merchants")
    .select("public_slug")
    .eq("id", userId)
    .single();
  if (error || !data) {
    throw new Error(`查無 merchant（onboarding 可能未完成）：${error?.message}`);
  }
  return data.public_slug as string;
}

export async function getRateCardRows(userId: string): Promise<RateCardRow[]> {
  const { data, error } = await admin
    .from("rate_card_base")
    .select("id, category, subtype, base_price")
    .eq("merchant_id", userId)
    .order("category", { ascending: true });
  if (error) {
    throw new Error(`查詢 rate_card_base 失敗：${error.message}`);
  }
  return (data ?? []) as RateCardRow[];
}

/** 取商家最新一筆報價（匿名精靈送出後產生的那筆）。 */
export async function getLatestQuote(userId: string): Promise<QuoteRow | null> {
  const { data, error } = await admin
    .from("quotes")
    .select("id, session_id, quote_code, status, final_amount, sent_at")
    .eq("merchant_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`查詢 quotes 失敗：${error.message}`);
  }
  return (data as QuoteRow | null) ?? null;
}

export async function getQuoteById(quoteId: string): Promise<QuoteRow | null> {
  const { data, error } = await admin
    .from("quotes")
    .select("id, session_id, quote_code, status, final_amount, sent_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) {
    throw new Error(`查詢 quote 失敗：${error.message}`);
  }
  return (data as QuoteRow | null) ?? null;
}

export async function getRateCardBasePrice(rowId: string): Promise<number | null> {
  const { data, error } = await admin
    .from("rate_card_base")
    .select("base_price")
    .eq("id", rowId)
    .single();
  if (error || !data) {
    throw new Error(`查詢 rate_card_base 列失敗：${error?.message}`);
  }
  return data.base_price as number | null;
}

/**
 * 清理測試商家與其所有子資料。
 *
 * 先刪 sessions（cascade 到 raw_inputs/extracted_fields/clarification_turns/
 * price_line_items/quotes），再刪 auth user（cascade 到 merchants →
 * rate_card_base/modifiers）。分兩段是為了避開 price_line_items.rule_id →
 * rate_card_base 的 NO ACTION 外鍵在同一次 merchant cascade 中的刪除順序風險。
 */
/**
 * 為指定 session 寫入一段 agent 決策軌跡（A7）。
 *
 * 為什麼要 seed 而不是跑真的 agent：`AGENT_LOOP_ENABLED` 預設關閉（A6 的量測
 * 結論是暫不開啟），真實流程不會產生任何 agent_steps。但軌跡 UI 仍必須在有
 * 資料時正確呈現，否則它會在 flag 開啟的那一天才被發現壞掉。
 *
 * 刻意寫兩趟 loop 且第一趟含一個 rejected 步：這正是 A6 的 web-007 實際發生
 * 的形狀（模型一次問太多題被 tool 擋下、下一步自行修正），是最需要被 UI 正確
 * 呈現的情境——若把 rejected 顯示成失敗，護欄生效會看起來像故障。
 */
export async function seedAgentTrajectory(sessionId: string): Promise<void> {
  const firstRun = crypto.randomUUID();
  const secondRun = crypto.randomUUID();

  const { error } = await admin.from("agent_steps").insert([
    {
      session_id: sessionId,
      run_id: firstRun,
      step_index: 0,
      tool_name: "lookup_rate_card",
      status: "ok",
      tool_result: { subtypes: ["角色設計"] },
      latency_ms: 120,
    },
    {
      session_id: sessionId,
      run_id: firstRun,
      step_index: 1,
      tool_name: "ask_customer",
      status: "rejected",
      error_detail: "單輪最多 5 題，請只問最關鍵的欄位",
      latency_ms: 890,
    },
    {
      session_id: sessionId,
      run_id: firstRun,
      step_index: 2,
      tool_name: "ask_customer",
      status: "ok",
      tool_args: { questions: [{ target_field: "quantity", question: "需要幾張？" }] },
      latency_ms: 760,
    },
    {
      session_id: sessionId,
      run_id: secondRun,
      step_index: 0,
      tool_name: "record_fields",
      status: "ok",
      latency_ms: 640,
    },
    {
      session_id: sessionId,
      run_id: secondRun,
      step_index: 1,
      tool_name: "compute_quote",
      status: "ok",
      tool_result: { final_amount: 4321 },
      latency_ms: 210,
    },
  ]);

  if (error) {
    throw new Error(`seed agent_steps 失敗：${error.message}`);
  }
}

export async function cleanupUser(userId: string | null): Promise<void> {
  if (userId === null) return;
  await admin.from("sessions").delete().eq("merchant_id", userId);
  await admin.auth.admin.deleteUser(userId).catch(() => {
    console.error(
      `⚠️ 清理測試商家失敗，請至 Supabase Studio 手動刪除 auth user ${userId}`,
    );
  });
}
