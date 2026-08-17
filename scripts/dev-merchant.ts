/**
 * Dev 商家共用 helper（seed 與各 verify script 共用，單一事實來源）。
 * 多租戶後所有整合驗證都需要一個 tenant context——統一用 slug=dev 的本機商家。
 */
import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { requireEnv } from "@/lib/env.ts";

/**
 * ── 密碼為何不寫在這裡 ──
 * 這個帳號是 Supabase 裡的**真實** auth user，而本專案的開發與 production
 * 共用同一個 Supabase 專案（見 docs/deployment.md）。把密碼寫死在原始碼，
 * 等於 repo 一旦公開，任何人都能登入這個商家的後台。
 * 帳號 email 是識別碼、可以公開；密碼一律從環境變數取。
 */
export const DEV_MERCHANT = {
  email: "dev@bizmate.local",
  displayName: "Dev 商家",
  slug: "dev",
} as const;

/** 取 dev 商家密碼；未設定時明確報錯而非退回預設值。 */
function devMerchantPassword(): string {
  return requireEnv("DEV_MERCHANT_PASSWORD");
}

/**
 * 找既有 dev auth user 或新建一個；回傳 user id。
 *
 * 帳號已存在時**一併把密碼同步成環境變數的值**。原本只找回 id 不動密碼，
 * 「冪等」就只保證帳號存在、不保證密碼是對的——輪換密碼時得另外進 Supabase
 * 後台處理，而後台只提供寄送重設信，寄到 dev@bizmate.local 這種保留網域
 * 根本收不到。同步之後，改 .env.local 再跑一次腳本就等於完成輪換。
 */
async function ensureDevAuthUser(): Promise<string> {
  const client = getSupabaseClient();
  const password = devMerchantPassword();

  const { data: created, error } = await client.auth.admin.createUser({
    email: DEV_MERCHANT.email,
    password,
    email_confirm: true,
  });
  if (!error) {
    return created.user.id;
  }

  // 已存在（email_exists）→ 從使用者清單找回 id；其他錯誤直接拋出
  if (!error.message.toLowerCase().includes("already")) {
    throw new Error(`建立 dev auth user 失敗：${error.message}`);
  }
  const { data: list, error: listError } = await client.auth.admin.listUsers();
  if (listError) {
    throw new Error(`查詢 auth users 失敗：${listError.message}`);
  }
  const existing = list.users.find((user) => user.email === DEV_MERCHANT.email);
  if (!existing) {
    throw new Error("dev auth user 已存在但查不到，請至 Supabase Studio 檢查");
  }

  const { error: updateError } = await client.auth.admin.updateUserById(existing.id, {
    password,
  });
  if (updateError) {
    throw new Error(`同步 dev 商家密碼失敗：${updateError.message}`);
  }
  return existing.id;
}

/** 冪等地確保 dev 商家存在（auth user + merchants 列），回傳 merchant id。 */
export async function ensureDevMerchant(): Promise<string> {
  const client = getSupabaseClient();
  const userId = await ensureDevAuthUser();

  const { error } = await client.from("merchants").upsert(
    {
      id: userId,
      display_name: DEV_MERCHANT.displayName,
      public_slug: DEV_MERCHANT.slug,
      contact_email: DEV_MERCHANT.email,
    },
    { onConflict: "id" },
  );
  if (error) {
    throw new Error(`upsert dev merchant 失敗：${error.message}`);
  }
  return userId;
}
