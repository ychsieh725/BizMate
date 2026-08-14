import Image from "next/image";
import Link from "next/link";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";

const REPO_URL = "https://github.com/ychsieh725/BizMate";

export function SiteFooter() {
  return (
    <footer className="bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-3">
          <Image
            src="/bizmate-logo.png"
            alt="BizMate"
            width={88}
            height={28}
            /* self-start 不可省：父層是 flex-col，交叉軸的 stretch 會蓋掉 w-auto
               把圖片拉滿容器寬度（放大後糊掉）。 */
            className="h-6 w-auto self-start"
          />
          <p className="max-w-xs text-sm leading-relaxed text-ink-faint">
            給接案者的自動報價系統。口語需求進來，有依據的報價單出去。
          </p>
        </div>

        <nav aria-label="頁尾導覽" className="flex flex-col gap-3 text-sm">
          <Link
            href={PAGE_ROUTES.login}
            className="text-ink-soft transition-colors hover:text-ink"
          >
            登入
          </Link>
          <Link
            href={PAGE_ROUTES.signup}
            className="text-ink-soft transition-colors hover:text-ink"
          >
            註冊帳號
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-soft transition-colors hover:text-ink"
          >
            GitHub 原始碼
          </a>
        </nav>
      </div>

      <div className="border-t border-surface-line">
        <p className="mx-auto max-w-6xl px-6 py-6 text-sm text-ink-faint">
          已經有商家給你的連結？直接開啟{" "}
          <code className="rounded-md bg-surface-subtle px-1.5 py-0.5 font-mono text-ink-soft">
            /q/商家代號
          </code>{" "}
          即可開始報價，不需註冊。
        </p>
      </div>
    </footer>
  );
}
