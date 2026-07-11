import Link from "next/link";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { listQuotesQuerySchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { formatAmount, formatDateTime } from "./formatters.ts";

const ALL_TAB = { label: "全部", href: PAGE_ROUTES.dashboardQuotes } as const;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
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

  const { status: statusParam } = await searchParams;
  const parsed = listQuotesQuerySchema.safeParse(
    statusParam === undefined ? {} : { status: statusParam },
  );
  // 網址帶入非法 status 不報錯，視同「全部」——瀏覽器網址列不是 API 邊界。
  const activeStatus = parsed.success ? parsed.data.status : undefined;
  const items = await listQuotes(auth.merchantId, activeStatus);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">報價管理</h1>
        <Link href={PAGE_ROUTES.dashboard} className="text-sm underline">
          返回 Dashboard
        </Link>
      </div>

      <nav aria-label="狀態篩選" className="flex gap-2 text-sm">
        <Link
          href={ALL_TAB.href}
          aria-current={activeStatus === undefined ? "page" : undefined}
          className="rounded border px-3 py-1 aria-[current=page]:bg-gray-900 aria-[current=page]:text-white"
        >
          {ALL_TAB.label}
        </Link>
        {QUOTE_STATUSES.map((status) => (
          <Link
            key={status}
            href={`${PAGE_ROUTES.dashboardQuotes}?status=${status}`}
            aria-current={activeStatus === status ? "page" : undefined}
            className="rounded border px-3 py-1 aria-[current=page]:bg-gray-900 aria-[current=page]:text-white"
          >
            {QUOTE_STATUS_LABELS[status]}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="text-sm text-gray-600">
          尚無報價。把你的專屬連結傳給客戶，他們送出的需求會出現在這裡。
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">報價列表</caption>
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">報價編號</th>
              <th className="py-2">分類</th>
              <th className="py-2">客戶 Email</th>
              <th className="py-2">金額</th>
              <th className="py-2">狀態</th>
              <th className="py-2">建立時間</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2 font-mono">{item.quote_code}</td>
                <td className="py-2">
                  {item.category === null ? "—" : CASE_CATEGORY_LABELS[item.category]}
                </td>
                <td className="py-2">{item.contact_email ?? "—"}</td>
                <td className="py-2">
                  {formatAmount(item.final_amount)}
                  {item.is_conservative && (
                    <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      保守估算
                    </span>
                  )}
                </td>
                <td className="py-2">{QUOTE_STATUS_LABELS[item.status]}</td>
                <td className="py-2">{formatDateTime(item.created_at)}</td>
                <td className="py-2">
                  <Link
                    href={PAGE_ROUTES.dashboardQuote(item.id)}
                    className="underline"
                  >
                    查看
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
