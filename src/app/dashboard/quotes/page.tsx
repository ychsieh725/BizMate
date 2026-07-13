import Link from "next/link";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { listQuotesQuerySchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { StatusPill } from "../StatusPill.tsx";
import { formatAmount, formatDateTime } from "./formatters.ts";

const ALL_TAB = { label: "全部", href: PAGE_ROUTES.dashboardQuotes } as const;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return null;
  }

  const { status: statusParam } = await searchParams;
  const parsed = listQuotesQuerySchema.safeParse(
    statusParam === undefined ? {} : { status: statusParam },
  );
  const activeStatus = parsed.success ? parsed.data.status : undefined;
  const items = await listQuotes(auth.merchantId, activeStatus);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">報價管理</h1>

      <nav aria-label="狀態篩選" className="flex flex-wrap gap-2 text-sm">
        <Link
          href={ALL_TAB.href}
          aria-current={activeStatus === undefined ? "page" : undefined}
          className="text-ink-soft rounded-full border border-[var(--surface-line)] px-3 py-1.5 aria-[current=page]:border-[var(--ink)] aria-[current=page]:bg-[var(--ink)] aria-[current=page]:text-[var(--surface)]"
        >
          {ALL_TAB.label}
        </Link>
        {QUOTE_STATUSES.map((status) => (
          <Link
            key={status}
            href={`${PAGE_ROUTES.dashboardQuotes}?status=${status}`}
            aria-current={activeStatus === status ? "page" : undefined}
            className="text-ink-soft rounded-full border border-[var(--surface-line)] px-3 py-1.5 aria-[current=page]:border-[var(--ink)] aria-[current=page]:bg-[var(--ink)] aria-[current=page]:text-[var(--surface)]"
          >
            {QUOTE_STATUS_LABELS[status]}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="card-float text-ink-soft rounded-[24px] bg-[var(--surface)] p-6 text-sm">
          尚無報價。把你的專屬連結傳給客戶，他們送出的需求會出現在這裡。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={PAGE_ROUTES.dashboardQuote(item.id)}
              className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-4 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-center gap-3">
                <span className="bg-accent flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold text-white">
                  {item.category === null ? "?" : CASE_CATEGORY_LABELS[item.category].charAt(0)}
                </span>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="text-ink font-mono text-sm font-semibold">
                    {item.quote_code}
                  </span>
                  <span className="text-ink-faint text-xs">
                    {formatDateTime(item.created_at)}
                  </span>
                </div>
              </div>

              <p className="text-ink-soft truncate text-sm">
                {item.contact_email ?? "—"}
              </p>

              <div className="flex items-center gap-2">
                <StatusPill status={item.status} label={QUOTE_STATUS_LABELS[item.status]} />
                {item.is_conservative && (
                  <span className="bg-status-review-bg text-status-review-fg rounded-full px-2.5 py-1 text-[11px] font-medium">
                    保守估算
                  </span>
                )}
                <span className="text-ink ml-auto font-mono text-sm font-medium tabular-nums">
                  {formatAmount(item.final_amount)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
