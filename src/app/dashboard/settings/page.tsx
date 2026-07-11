import Link from "next/link";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { SettingsForm } from "./SettingsForm.tsx";

export default async function SettingsPage() {
  const auth = await requireMerchant();

  if (!auth.ok) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-red-600">
          {auth.status === 401 ? "請先登入" : "查無商家資料，請先完成 onboarding"}
        </p>
      </main>
    );
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">帳號設定</h1>
        <Link href={PAGE_ROUTES.dashboard} className="text-sm underline">
          返回 Dashboard
        </Link>
      </div>
      <SettingsForm
        initialDisplayName={merchant.display_name}
        initialSlug={merchant.public_slug}
      />
    </main>
  );
}
