import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { fieldLabel } from "@/shared/constants/fieldLabels.ts";
import { formatAmount, formatDateTime } from "../formatters.ts";
import { StatusPill } from "../../StatusPill.tsx";
import { QuoteActions } from "./QuoteActions.tsx";
import { SendQuoteButton } from "./SendQuoteButton.tsx";
import { AgentTrajectory } from "./AgentTrajectory.tsx";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return null;
  }

  const { id } = await params;
  const idParsed = quoteIdSchema.safeParse(id);
  if (!idParsed.success) {
    notFound();
  }

  const detail = await getQuoteDetail(idParsed.data, auth.merchantId);
  if (detail === null) {
    notFound();
  }

  const {
    quote,
    session,
    lineItems,
    extractedFields,
    clarifications,
    rawInputs,
    agentSteps,
  } = detail;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-accent-soft text-base font-bold text-accent">
          {CASE_CATEGORY_LABELS[session.category].charAt(0)}
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-lg font-semibold text-ink">
            {quote.quote_code}
          </span>
          <span className="text-sm text-ink-soft">{session.contact_email ?? "—"}</span>
        </div>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-surface-line bg-surface shadow-card p-6">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-ink-soft">分類</dt>
          <dd className="text-ink">{CASE_CATEGORY_LABELS[session.category]}</dd>
          <dt className="text-ink-soft">狀態</dt>
          <dd>
            <StatusPill status={quote.status} label={QUOTE_STATUS_LABELS[quote.status]} />
          </dd>
          <dt className="text-ink-soft">建立時間</dt>
          <dd className="text-ink">{formatDateTime(quote.created_at)}</dd>
        </dl>

        <div className="flex items-center justify-between rounded-xl bg-accent-ink px-5 py-4 text-surface">
          <span className="text-sm text-white/70">最終金額</span>
          <span className="font-mono text-xl font-medium tabular-nums">
            {formatAmount(quote.final_amount)}
          </span>
        </div>
        {quote.is_conservative && (
          <p className="rounded-xl bg-status-review-bg px-3 py-2 text-xs text-status-review-fg">
            保守估算（資訊不足，客戶未完成反問）
          </p>
        )}
      </section>

      {quote.status === "awaiting_review" && (
        <QuoteActions quoteId={quote.id} initialAmount={quote.final_amount} />
      )}
      {quote.status === "confirmed" && <SendQuoteButton quoteId={quote.id} />}

      <section className="flex flex-col gap-2 rounded-2xl border border-surface-line bg-surface shadow-card p-6">
        <h2 className="text-ink text-sm font-semibold">費用明細</h2>
        {lineItems.length === 0 ? (
          <p className="text-ink-soft text-sm">無費用明細</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">費用明細</caption>
            <thead>
              <tr className="border-b border-surface-line text-left">
                <th className="text-ink-soft py-2 font-normal">項目</th>
                <th className="text-ink-soft py-2 font-normal">金額</th>
                <th className="text-ink-soft py-2 font-normal">計價依據</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id} className="border-b border-surface-line align-top">
                  <td className="text-ink py-2">{item.item_name}</td>
                  <td className="text-ink py-2 font-mono tabular-nums">
                    {formatAmount(item.amount)}
                  </td>
                  <td className="text-ink-soft py-2">
                    {item.agent_reasoning ?? "固定費率查表"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 追溯依據：降階處理，視覺份量明顯低於上面的核心資訊 */}
      <section className="flex flex-col gap-2 rounded-2xl border border-surface-line bg-surface shadow-card p-5 text-xs">
        <h2 className="text-ink-soft font-medium">抽取欄位</h2>
        {extractedFields.length === 0 ? (
          <p className="text-ink-faint">無抽取欄位</p>
        ) : (
          <table className="w-full border-collapse">
            <caption className="sr-only">從客戶描述抽取的欄位</caption>
            <thead>
              <tr className="border-b border-surface-line text-left">
                <th className="text-ink-faint py-1.5 font-normal">欄位</th>
                <th className="text-ink-faint py-1.5 font-normal">值</th>
                <th className="text-ink-faint py-1.5 font-normal">信心</th>
                <th className="text-ink-faint py-1.5 font-normal">來源文字</th>
              </tr>
            </thead>
            <tbody>
              {extractedFields.map((field) => (
                <tr key={field.id} className="border-b border-surface-line align-top">
                  <td className="text-ink-soft py-1.5">{fieldLabel(field.field_name)}</td>
                  <td className="text-ink-soft py-1.5">{field.value ?? "—"}</td>
                  <td className="text-ink-soft py-1.5">
                    {field.confidence === null ? "—" : field.confidence.toFixed(2)}
                  </td>
                  <td className="text-ink-faint py-1.5">{field.source_span ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 抽取欄位顯示「抽到什麼」，軌跡顯示「怎麼決定的」，故緊接其後 */}
      <AgentTrajectory steps={agentSteps} />

      <section className="flex flex-col gap-2 rounded-2xl border border-surface-line bg-surface shadow-card p-5 text-xs">
        <h2 className="text-ink-soft font-medium">澄清歷程</h2>
        {clarifications.length === 0 ? (
          <p className="text-ink-faint">未觸發反問</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {clarifications.map((turn) => (
              <li key={turn.id} className="rounded-xl border border-surface-line p-3">
                <p className="text-ink-faint">
                  第 {turn.round} 輪 · 觸發欄位：{fieldLabel(turn.triggered_field)}
                </p>
                <p className="text-ink-soft mt-1">Q：{turn.question}</p>
                <p className="text-ink-soft mt-1">A：{turn.answer ?? "（未回答）"}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-surface-line bg-surface shadow-card p-5 text-xs">
        <h2 className="text-ink-soft font-medium">客戶原始描述</h2>
        {rawInputs.length === 0 ? (
          <p className="text-ink-faint">無原始描述</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {rawInputs.map((input) => (
              <li key={input.id} className="rounded-xl border border-surface-line p-3">
                <p className="text-ink-faint">{formatDateTime(input.created_at)}</p>
                <p className="text-ink-soft mt-1 whitespace-pre-wrap">{input.raw_text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
