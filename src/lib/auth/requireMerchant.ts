import { cache } from "react";
import { createClient } from "@/lib/supabase/serverClient.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";

export type RequireMerchantResult =
  | { ok: true; merchantId: string }
  | { ok: false; status: 401 | 403 };

/**
 * dashboard API 第一行呼叫的守門工具：cookie → auth.uid() → merchant 查詢。
 * 這是租戶隔離的主要保證（RLS policy 是第二道防線，見 5.4 spec）。
 * Supabase 呼叫例外一律 fail closed（401），不可 fail open。
 *
 * 包 cache()：dashboard/layout.tsx 與同層 page.tsx 都要呼叫本函式，
 * React 官方的 per-request memoization 模式讓同一次請求內的第二次呼叫
 * 直接吃快取、不重複打 Supabase。cache() 只在 React render context 內
 * 生效，Vitest 直接呼叫（無 render context）不受影響——已實測驗證。
 */
export const requireMerchant = cache(
  async (): Promise<RequireMerchantResult> => {
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
  },
);
