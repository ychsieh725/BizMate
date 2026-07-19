import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env.ts";
import type { Database } from "@/lib/supabase/database.types.ts";

type Result = { userId: string | null; response: NextResponse };

/**
 * middleware 專用：以 request cookie 建立 Supabase client、驗證 JWT 並刷新 session cookie。
 *
 * 用 getClaims() 而非 getUser()：本專案 JWT 為 ES256 非對稱簽章（JWKS 實測確認），
 * 驗證走 WebCrypto 本地完成、JWKS 快取於 function 實例，正常路徑零網路往返；
 * token 快過期時 supabase-js 仍會自動刷新並透過 setAll 寫回 cookie。
 * 安全邊界：middleware 只做 UX 重導，租戶隔離的主要守門在 requireMerchant
 * （getUser 伺服器端驗證，可感知撤銷）+ RLS 第二道防線。
 *
 * Supabase 呼叫失敗一律 fail closed（userId=null），不可讓例外讓保護路由誤放行。
 */
export async function getUserIdAndResponse(
  request: NextRequest,
): Promise<Result> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  try {
    const { data } = await supabase.auth.getClaims();
    return { userId: data?.claims.sub ?? null, response };
  } catch {
    return { userId: null, response };
  }
}
