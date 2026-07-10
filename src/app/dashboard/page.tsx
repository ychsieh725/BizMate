import { createClient } from "@/lib/supabase/serverClient.ts";
import { logoutAction } from "./actions.ts";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-gray-600">已登入：{user?.email}</p>
      <form action={logoutAction}>
        <button type="submit" className="rounded border px-4 py-2">
          登出
        </button>
      </form>
    </main>
  );
}
