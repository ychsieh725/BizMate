import { createClient } from "@/lib/supabase/serverClient.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";

export type RequireMerchantResult =
  | { ok: true; merchantId: string }
  | { ok: false; status: 401 | 403 };

/**
 * dashboard API 第一行呼叫的守門工具：cookie → auth.uid() → merchant 查詢。
 * 這是租戶隔離的主要保證（RLS policy 是第二道防線，見 5.4 spec）。
 * Supabase 呼叫例外一律 fail closed（401），不可 fail open。
 */
export async function requireMerchant(): Promise<RequireMerchantResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user === null) {
      return { ok: false, status: 401 };
    }

    const merchant = await merchantsRepository.findById(user.id);
    if (merchant === null) {
      return { ok: false, status: 403 };
    }

    return { ok: true, merchantId: user.id };
  } catch {
    return { ok: false, status: 401 };
  }
}
