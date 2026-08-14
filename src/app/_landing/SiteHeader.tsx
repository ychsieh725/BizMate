import Image from "next/image";
import Link from "next/link";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";

/**
 * 行銷首頁導覽列。半透明毛玻璃 + 細下緣線，捲動時內容從底下穿過，
 * 是 Linear / Stripe 一類產品站的共同語彙。
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-surface-line/80 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href={PAGE_ROUTES.home} aria-label="BizMate 首頁">
          <Image
            src="/bizmate-logo.png"
            alt="BizMate"
            width={88}
            height={28}
            priority
            className="h-7 w-auto"
          />
        </Link>

        <nav aria-label="主要導覽" className="flex items-center gap-2">
          <Link
            href={PAGE_ROUTES.login}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            登入
          </Link>
          <Link
            href={PAGE_ROUTES.signup}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            開始使用
          </Link>
        </nav>
      </div>
    </header>
  );
}
