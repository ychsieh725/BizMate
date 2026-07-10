import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env.ts";
import type { Database } from "@/lib/supabase/database.types.ts";

/**
 * Server Component / Server Action 用的 Supabase client。
 * 以使用者 session cookie 建立（非 service_role），會套用 RLS。
 * 每次呼叫皆重建（cookies() 綁定當次 request，不可跨請求快取單例）。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component 呼叫 setAll 一定會拋錯（該情境無法寫 cookie）；
            // middleware（Task 5/6）已負責刷新 session，這裡可安全忽略。
          }
        },
      },
    },
  );
}
