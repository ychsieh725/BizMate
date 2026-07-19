import Link from "next/link";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { CopyLinkButton } from "./CopyLinkButton.tsx";

export default async function DashboardPage() {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return null;
  }

  const [merchant, pendingCount] = await Promise.all([
    merchantsRepository.findById(auth.merchantId),
    quotesRepository.countByStatus(auth.merchantId, "awaiting_review"),
  ]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">總覽</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href={`${PAGE_ROUTES.dashboardQuotes}?status=awaiting_review`}
          className="flex flex-col gap-2 rounded-2xl border border-surface-line bg-surface p-6 shadow-card transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        >
          <span className="text-xs font-medium tracking-wide text-ink-soft uppercase">
            待審報價
          </span>
          <span className="font-mono text-3xl font-semibold tabular-nums text-ink">
            {pendingCount}
          </span>
        </Link>

        <div className="flex flex-col gap-3 rounded-2xl border border-surface-line bg-surface p-6 shadow-card">
          <span className="text-xs font-medium tracking-wide text-ink-soft uppercase">
            分享連結
          </span>
          {merchant !== null && (
            <>
              <p className="text-sm text-ink-soft">
                把這個連結傳給客戶，他們的需求會出現在待審報價裡。
              </p>
              <CopyLinkButton slug={merchant.public_slug} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
