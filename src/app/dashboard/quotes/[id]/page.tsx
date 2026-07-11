import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { fieldLabel } from "@/shared/constants/fieldLabels.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { formatAmount, formatDateTime } from "../formatters.ts";
import { QuoteActions } from "./QuoteActions.tsx";
import { SendQuoteButton } from "./SendQuoteButton.tsx";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
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

  const { id } = await params;
  const idParsed = quoteIdSchema.safeParse(id);
  if (!idParsed.success) {
    notFound();
  }

  // 查無或非本商家所有一律 404（service 已做歸屬檢查）。
  const detail = await getQuoteDetail(idParsed.data, auth.merchantId);
  if (detail === null) {
    notFound();
  }

  const { quote, session, lineItems, extractedFields, clarifications, rawInputs } =
    detail;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          報價 <span className="font-mono">{quote.quote_code}</span>
        </h1>
        <Link href={PAGE_ROUTES.dashboardQuotes} className="text-sm underline">
          返回報價列表
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">報價摘要</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-gray-600">分類</dt>
          <dd>{CASE_CATEGORY_LABELS[session.category]}</dd>
          <dt className="text-gray-600">客戶 Email</dt>
          <dd>{session.contact_email ?? "—"}</dd>
          <dt className="text-gray-600">金額</dt>
          <dd>
            {formatAmount(quote.final_amount)}
            {quote.is_conservative && (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                保守估算（資訊不足，客戶未完成反問）
              </span>
            )}
          </dd>
          <dt className="text-gray-600">狀態</dt>
          <dd>{QUOTE_STATUS_LABELS[quote.status]}</dd>
          <dt className="text-gray-600">建立時間</dt>
          <dd>{formatDateTime(quote.created_at)}</dd>
        </dl>
      </section>

      {quote.status === "awaiting_review" && (
        <QuoteActions quoteId={quote.id} initialAmount={quote.final_amount} />
      )}

      {quote.status === "confirmed" && <SendQuoteButton quoteId={quote.id} />}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">費用明細</h2>
        {lineItems.length === 0 ? (
          <p className="text-sm text-gray-600">無費用明細</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">費用明細</caption>
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">項目</th>
                <th className="py-2">金額</th>
                <th className="py-2">計價依據</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id} className="border-b align-top">
                  <td className="py-2">{item.item_name}</td>
                  <td className="py-2">{formatAmount(item.amount)}</td>
                  <td className="py-2 text-gray-600">
                    {item.agent_reasoning ?? "固定費率查表"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">抽取欄位</h2>
        {extractedFields.length === 0 ? (
          <p className="text-sm text-gray-600">無抽取欄位</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">從客戶描述抽取的欄位</caption>
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">欄位</th>
                <th className="py-2">值</th>
                <th className="py-2">信心</th>
                <th className="py-2">來源文字</th>
              </tr>
            </thead>
            <tbody>
              {extractedFields.map((field) => (
                <tr key={field.id} className="border-b align-top">
                  <td className="py-2">{fieldLabel(field.field_name)}</td>
                  <td className="py-2">{field.value ?? "—"}</td>
                  <td className="py-2">
                    {field.confidence === null ? "—" : field.confidence.toFixed(2)}
                  </td>
                  <td className="py-2 text-gray-600">{field.source_span ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">澄清歷程</h2>
        {clarifications.length === 0 ? (
          <p className="text-sm text-gray-600">未觸發反問</p>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            {clarifications.map((turn) => (
              <li key={turn.id} className="rounded border p-3">
                <p className="text-gray-600">
                  第 {turn.round} 輪 · 觸發欄位：{fieldLabel(turn.triggered_field)}
                </p>
                <p className="mt-1">Q：{turn.question}</p>
                <p className="mt-1">A：{turn.answer ?? "（未回答）"}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">客戶原始描述</h2>
        {rawInputs.length === 0 ? (
          <p className="text-sm text-gray-600">無原始描述</p>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            {rawInputs.map((input) => (
              <li key={input.id} className="rounded border p-3">
                <p className="text-gray-600">{formatDateTime(input.created_at)}</p>
                <p className="mt-1 whitespace-pre-wrap">{input.raw_text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
