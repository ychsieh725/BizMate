import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { QuotePreview } from "./QuotePreview";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-surface-line">
      {/* 極淡格線：給大面積白底一點結構感，向下與向外漸隱以免搶主體 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(15,17,21,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,17,21,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
      />

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:py-28">
        <div className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-surface-line bg-surface-subtle px-3 py-1 text-xs font-medium text-ink-soft">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
            AI 需求解析 · 確定性計價
          </span>

          <h1 className="text-4xl font-semibold leading-[1.15] tracking-tight text-ink text-balance sm:text-5xl lg:text-[3.5rem]">
            把口語需求，變成
            <br />
            有依據的正式報價單
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-ink-soft text-pretty">
            客戶用一段話說完需求，系統自動解析欄位、依你的價目表算出金額。
            你只要在後台看一眼，按下確認就寄出。
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href={PAGE_ROUTES.signup}
              className="group inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              免費開始使用
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
            <Link
              href="#how-it-works"
              className="rounded-xl border border-surface-line px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle"
            >
              看看怎麼運作
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-4 text-sm text-ink-faint">
            <span>支援案件類型</span>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(CASE_CATEGORY_LABELS).map(([key, label]) => (
                <li
                  key={key}
                  className="rounded-lg border border-surface-line px-2.5 py-1 text-xs text-ink-soft"
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <QuotePreview />
      </div>
    </section>
  );
}
