import { getSupabaseClient } from "@/lib/supabase/client.ts";

/**
 * 公開端點固定視窗限流（SDS §13.3、NFR-7）。
 * 計數狀態落在 Supabase（durable，跨 Serverless 實例共享），透過原子 RPC
 * increment_rate_limit 完成「計數 + 上限判斷」，避免 read-then-write 競態。
 */

export type RateLimitRule = {
  /** 視窗內允許的最大請求數。 */
  readonly limit: number;
  /** 視窗長度（毫秒）。 */
  readonly windowMs: number;
};

/** POST /sessions 的限流規則：同一 IP 每小時 10 次（NFR-7）。 */
export const SESSION_CREATE_RULE: RateLimitRule = {
  limit: 10,
  windowMs: 60 * 60 * 1000,
};

/** 從代理標頭取客戶端 IP（Vercel 設定 x-forwarded-for）；取不到回 "unknown"。 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

/** 對齊固定視窗起點（floor 到 windowMs 邊界）。 */
export function windowStartFor(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * 固定視窗限流檢查。
 * fail-open：RPC 失敗時放行（可用性優先）並記錄——限流是防濫用機制，
 * 不應因限流層本身故障而讓正常使用者全被擋下。
 */
export async function checkRateLimit(
  bucketKey: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): Promise<{ allowed: boolean }> {
  const windowStart = windowStartFor(now, rule.windowMs);
  try {
    const { data, error } = await getSupabaseClient().rpc("increment_rate_limit", {
      p_bucket_key: bucketKey,
      p_window_start: windowStart.toISOString(),
      p_limit: rule.limit,
    });
    if (error) {
      console.error("[rateLimit] RPC 失敗，fail-open 放行：", error);
      return { allowed: true };
    }
    return { allowed: data === true };
  } catch (error) {
    console.error("[rateLimit] 例外，fail-open 放行：", error);
    return { allowed: true };
  }
}
