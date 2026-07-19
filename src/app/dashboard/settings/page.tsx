import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { SettingsForm } from "./SettingsForm.tsx";

export default async function SettingsPage() {
  const auth = await requireMerchant();
  // layout 已攔截未登入/無商家的情況（不會渲染到這裡）；
  // 這裡的 if 只是讓 TypeScript 把 auth 窄化成 ok: true 分支。
  if (!auth.ok) {
    return null;
  }

  // merchant 直接取自 requireMerchant（同請求內已查過），不再重打 DB。
  const { merchant } = auth;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">帳號設定</h1>
      <div className="rounded-2xl border border-surface-line bg-surface p-6 shadow-card">
        <SettingsForm
          initialDisplayName={merchant.display_name}
          initialSlug={merchant.public_slug}
        />
      </div>
    </main>
  );
}
