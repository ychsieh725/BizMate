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
      <h1 className="text-ink text-2xl font-semibold tracking-tight">總覽</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href={`${PAGE_ROUTES.dashboardQuotes}?status=awaiting_review`}
          className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-6 transition-transform hover:-translate-y-0.5"
        >
          <span className="text-ink-soft text-xs font-medium tracking-wide uppercase">
            待審報價
          </span>
          <span className="text-ink font-mono text-3xl font-semibold tabular-nums">
            {pendingCount}
          </span>
        </Link>

        <div className="card-float flex flex-col gap-3 rounded-[24px] bg-[var(--surface)] p-6">
          <span className="text-ink-soft text-xs font-medium tracking-wide uppercase">
            分享連結
          </span>
          {merchant !== null && (
            <>
              <p className="text-ink-soft text-sm">
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
