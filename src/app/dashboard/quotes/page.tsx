import Link from "next/link";
import { Search } from "lucide-react";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { listQuotesQuerySchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { StatusPill } from "../StatusPill.tsx";
import { formatAmount, formatDateTime } from "./formatters.ts";

/** 狀態 tab 連結：切換狀態時保留目前的搜尋字串，兩者是正交的篩選條件。 */
function tabHref(status: string | undefined, q: string | undefined): string {
  const params = new URLSearchParams();
  if (status !== undefined) params.set("status", status);
  if (q !== undefined) params.set("q", q);
  const query = params.toString();
  return query === "" ? PAGE_ROUTES.dashboardQuotes : `${PAGE_ROUTES.dashboardQuotes}?${query}`;
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return null;
  }

  const { status: statusParam, q: qParam } = await searchParams;
  const parsed = listQuotesQuerySchema.safeParse({
    ...(statusParam === undefined ? {} : { status: statusParam }),
    ...(qParam === undefined ? {} : { q: qParam }),
  });
  const activeStatus = parsed.success ? parsed.data.status : undefined;
  const activeQuery = parsed.success ? parsed.data.q : undefined;
  const items = await listQuotes(auth.merchantId, activeStatus, activeQuery);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">報價管理</h1>

      {/* GET 表單：不需要 client component，沿用專案既有「URL query 驅動 SSR」慣例
          （同狀態篩選 tab），送出後瀏覽器直接導到 ?q=... 由伺服器端過濾。 */}
      <form
        action={PAGE_ROUTES.dashboardQuotes}
        className="flex items-center gap-2.5 rounded-xl border border-surface-line bg-surface px-4 py-2.5 text-sm text-ink-soft transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft"
      >
        <Search className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
        {activeStatus !== undefined && (
          <input type="hidden" name="status" value={activeStatus} />
        )}
        <input
          type="text"
          name="q"
          defaultValue={activeQuery ?? ""}
          placeholder="搜尋報價編號、客戶、狀態"
          aria-label="搜尋報價"
          className="w-full bg-transparent text-ink outline-none placeholder:text-ink-faint"
        />
      </form>

      <nav aria-label="狀態篩選" className="flex flex-wrap gap-2 text-sm">
        <Link
          href={tabHref(undefined, activeQuery)}
          aria-current={activeStatus === undefined ? "page" : undefined}
          className="rounded-full border border-surface-line px-3 py-1.5 text-ink-soft transition-colors hover:border-accent hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent-soft aria-[current=page]:border-accent aria-[current=page]:bg-accent aria-[current=page]:text-white"
        >
          全部
        </Link>
        {QUOTE_STATUSES.map((status) => (
          <Link
            key={status}
            href={tabHref(status, activeQuery)}
            aria-current={activeStatus === status ? "page" : undefined}
            className="rounded-full border border-surface-line px-3 py-1.5 text-ink-soft transition-colors hover:border-accent hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent-soft aria-[current=page]:border-accent aria-[current=page]:bg-accent aria-[current=page]:text-white"
          >
            {QUOTE_STATUS_LABELS[status]}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-surface-line bg-surface p-6 text-sm text-ink-soft shadow-card">
          {activeQuery !== undefined
            ? "找不到符合的報價，換個關鍵字試試。"
            : "尚無報價。把你的專屬連結傳給客戶，他們送出的需求會出現在這裡。"}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={PAGE_ROUTES.dashboardQuote(item.id)}
              className="flex flex-col gap-2 rounded-2xl border border-surface-line bg-surface p-4 shadow-card transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                  {item.category === null ? "?" : CASE_CATEGORY_LABELS[item.category].charAt(0)}
                </span>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="font-mono text-sm font-semibold text-ink">
                    {item.quote_code}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {formatDateTime(item.created_at)}
                  </span>
                </div>
              </div>

              <p className="truncate text-sm text-ink-soft">
                {item.contact_email ?? "—"}
              </p>

              <div className="flex items-center gap-2">
                <StatusPill status={item.status} label={QUOTE_STATUS_LABELS[item.status]} />
                {item.is_conservative && (
                  <span className="rounded-full bg-status-review-bg px-2.5 py-1 text-[11px] font-medium text-status-review-fg">
                    保守估算
                  </span>
                )}
                <span className="ml-auto font-mono text-sm font-medium tabular-nums text-ink">
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
