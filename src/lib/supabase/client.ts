import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env.ts";
import type { Database } from "@/lib/supabase/database.types.ts";

/**
 * 伺服器端 Supabase client（單例）。
 *
 * ⚠️ 僅供伺服器端使用：以 service_role key 建立，會繞過 RLS。
 * 絕不可在客戶端 bundle 匯入（key 命名不含 NEXT_PUBLIC_，Next.js 不會外洩）。
 *
 * 用單例避免每次請求重建連線物件；serverless 環境下每個 function 實例快取一份。
 */
let cachedClient: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // 伺服器端不需要 session 持久化與自動刷新
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  return cachedClient;
}
