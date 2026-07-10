import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env.ts";
import type { Database } from "@/lib/supabase/database.types.ts";
import type { User } from "@supabase/supabase-js";

type Result = { user: User | null; response: NextResponse };

/**
 * middleware 專用：以 request cookie 建立 Supabase client 並刷新 session cookie。
 * Supabase 呼叫失敗一律 fail closed（user=null），不可讓例外讓保護路由誤放行。
 */
export async function getUserAndResponse(
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { user, response };
  } catch {
    return { user: null, response };
  }
}
