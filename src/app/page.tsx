import Link from "next/link";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories";

/**
 * BizMate 首頁佔位。
 * P0（任務 3.6）會替換為正式的 Wizard Step 1 案件類型選擇畫面。
 * 此版僅提供可運行、可導覽的骨架入口，不含業務邏輯。
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-8 px-6 py-24">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          BizMate
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          把口語需求，變成有依據的正式報價單
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          多 Agent 解析、可追溯定價、接案者 LINE 人工終審。
        </p>
      </header>

      <section aria-labelledby="categories-heading" className="flex flex-col gap-3">
        <h2 id="categories-heading" className="text-sm font-medium text-zinc-500">
          支援案件類型
        </h2>
        <ul className="flex flex-wrap gap-2">
          {Object.entries(CASE_CATEGORY_LABELS).map(([key, label]) => (
            <li
              key={key}
              className="rounded-full border border-black/[.08] px-4 py-1.5 text-sm dark:border-white/[.145]"
            >
              {label}
            </li>
          ))}
        </ul>
      </section>

      <Link
        href="/wizard"
        className="inline-flex h-12 w-fit items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90"
      >
        開始報價（P0 建置中）
      </Link>
    </main>
  );
}
