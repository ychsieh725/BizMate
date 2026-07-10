import Link from "next/link";
import { logoutAction } from "./actions.ts";
import { CopyLinkButton } from "./CopyLinkButton.tsx";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";

export default async function DashboardPage() {
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

  const [merchant, pendingCount] = await Promise.all([
    merchantsRepository.findById(auth.merchantId),
    quotesRepository.countByStatus(auth.merchantId, "awaiting_review"),
  ]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-gray-600">待審報價：{pendingCount} 筆</p>
      {merchant !== null && <CopyLinkButton slug={merchant.public_slug} />}
      <Link href="/dashboard/services" className="text-sm underline">
        管理服務項目
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="rounded border px-4 py-2">
          登出
        </button>
      </form>
    </main>
  );
}
