import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories";

/**
 * BizMate 首頁佔位。
 * 多租戶重構後報價入口是各商家的專屬連結 /q/{slug}，首頁不再直連 wizard；
 * M2 起將加上註冊/登入導流（landing 正式版在 M6）。
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
          註冊帳號、管理你的服務與價格，把專屬連結傳給客戶自動報價。
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

      <p className="text-sm text-zinc-500">
        已有商家連結？直接開啟 <code className="rounded bg-black/[.05] px-1.5 py-0.5 dark:bg-white/[.1]">/q/商家代號</code> 即可開始報價。
      </p>
    </main>
  );
}
