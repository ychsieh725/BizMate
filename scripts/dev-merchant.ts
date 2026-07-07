/**
 * Dev 商家共用 helper（seed 與各 verify script 共用，單一事實來源）。
 * 多租戶後所有整合驗證都需要一個 tenant context——統一用 slug=dev 的本機商家。
 */
import { getSupabaseClient } from "@/lib/supabase/client.ts";

export const DEV_MERCHANT = {
  email: "dev@bizmate.local",
  password: "dev-only-local-password",
  displayName: "Dev 商家",
  slug: "dev",
} as const;

/** 找既有 dev auth user 或新建一個；回傳 user id。 */
async function ensureDevAuthUser(): Promise<string> {
  const client = getSupabaseClient();

  const { data: created, error } = await client.auth.admin.createUser({
    email: DEV_MERCHANT.email,
    password: DEV_MERCHANT.password,
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
