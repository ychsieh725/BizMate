import Link from "next/link";
import { PAGE_ROUTES } from "@/shared/constants/routes";

/**
 * Wizard 佔位頁。P0（任務 3.6）替換為 Step 1-4 完整流程。
 * 目前僅確保路由存在、可從首頁導覽，不含任何狀態或 API 呼叫。
 */
export default function WizardPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">報價流程</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        階段式輸入介面建置中（P0 · 任務 3.6）。
      </p>
      <Link
        href={PAGE_ROUTES.home}
        className="text-sm font-medium underline underline-offset-4"
      >
        ← 回首頁
      </Link>
    </main>
  );
}
