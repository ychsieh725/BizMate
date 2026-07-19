import type { Tables } from "@/lib/supabase/database.types.ts";
import type { RequireMerchantResult } from "./requireMerchant.ts";

/**
 * 測試專用：組出 requireMerchant ok 分支的完整回傳值。
 * requireMerchant 自帶 merchant 本體後，API route 測試若逐檔手寫
 * merchant fixture 會重複七份——集中一處，欄位變動只改這裡。
 * 注意：id 需為合規 UUID（zod4 嚴格 .uuid()），由呼叫端傳入。
 */
export function authOkFixture(merchantId: string): RequireMerchantResult {
  const merchant: Tables<"merchants"> = {
    id: merchantId,
    display_name: "測試商家",
    public_slug: "test123",
    contact_email: "test@example.com",
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
  };
  return { ok: true, merchantId, merchant };
}
