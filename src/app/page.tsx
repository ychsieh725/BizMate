import Link from "next/link";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";

/**
 * BizMate 首頁（根目錄）。
 * 多租戶重構後報價入口是各商家的專屬連結 /q/{slug}，首頁不再直連 wizard，
 * 改導流註冊/登入。
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
        <div className="flex items-center gap-4">
          <Link
            href={PAGE_ROUTES.signup}
            className="rounded bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            開始使用
          </Link>
          <Link href={PAGE_ROUTES.login} className="text-sm underline">
            已有帳號？登入
          </Link>
        </div>
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
