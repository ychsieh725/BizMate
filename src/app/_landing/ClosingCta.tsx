import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";

export function ClosingCta() {
  return (
    <section
      aria-labelledby="closing-cta-heading"
      className="border-b border-surface-line"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 py-20 text-center lg:py-24">
        <h2
          id="closing-cta-heading"
          className="text-3xl font-semibold tracking-tight text-ink text-balance sm:text-4xl"
        >
          下一個客戶問價時，讓系統先回答
        </h2>
        <p className="max-w-xl text-lg leading-relaxed text-ink-soft text-pretty">
          註冊後幾分鐘就能設定好價目表，拿到你的專屬報價連結。
        </p>
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
      </div>
    </section>
  );
}
