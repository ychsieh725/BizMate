/**
 * 客戶端中性首頁。/q/[slug] 報價向導的「回首頁」連結指向這裡——
 * 客戶是透過商家分享連結進來的訪客，不應被導去看商家登入/註冊行銷頁
 * （src/app/page.tsx，PAGE_ROUTES.home）。純靜態頁，不含任何導流 CTA。
 */
export default function ThanksPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-subtle px-4 py-10 sm:px-6">
      <div className="w-full max-w-md rounded-3xl border border-surface-line bg-surface p-8 text-center shadow-card sm:p-12">
        <p className="text-sm font-medium text-accent">BizMate</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
          感謝使用自動報價服務
        </h1>
        <p className="mt-3 text-sm text-ink-soft">
          您可以安全關閉此頁面。
        </p>
      </div>
    </main>
  );
}
