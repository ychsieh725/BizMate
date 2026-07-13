import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { SettingsForm } from "./SettingsForm.tsx";

export default async function SettingsPage() {
  const auth = await requireMerchant();
  // layout 已攔截未登入/無商家的情況（不會渲染到這裡）；
  // 這裡的 if 只是讓 TypeScript 把 auth 窄化成 { ok: true, merchantId } 型別。
  if (!auth.ok) {
    return null;
  }

  const merchant = await merchantsRepository.findById(auth.merchantId);
  if (merchant === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-red-600">系統忙碌，請稍後再試</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-8">
      <h1 className="text-2xl font-semibold">帳號設定</h1>
      <SettingsForm
        initialDisplayName={merchant.display_name}
        initialSlug={merchant.public_slug}
      />
    </main>
  );
}
