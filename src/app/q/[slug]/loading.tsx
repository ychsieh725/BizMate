/**
 * /q/[slug] 進入頁的載入骨架。
 * page.tsx 是 server component，要先查 findBySlug 解析商家才能渲染 wizard；
 * 客戶點開商家分享連結的第一印象若是空白畫面會顯得不可靠，這個 Suspense
 * 邊界讓查詢期間立即有內容佔位，之後由真正的 WizardPage 換入。
 * 外殼尺寸對齊 WizardPage 卡片式版面（bg-surface-subtle 頁面 + max-w-4xl
 * 白卡片 + 三欄大方格骨架），避免骨架換真內容時版面跳動。
 */
export default function QuoteEntryLoading() {
  return (
    <main
      role="status"
      aria-label="頁面載入中"
      className="flex min-h-screen items-center justify-center bg-surface-subtle px-4 py-10 sm:px-6 sm:py-16"
    >
      <div className="w-full max-w-4xl rounded-3xl border border-surface-line bg-surface p-8 shadow-card sm:p-12">
        <div className="mb-6 h-4 w-32 animate-pulse rounded-md bg-surface-line" />
        <div className="mb-8 h-8 w-2/3 animate-pulse rounded-lg bg-surface-line" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
          <div className="h-48 animate-pulse rounded-2xl border border-surface-line bg-surface-subtle" />
          <div className="h-48 animate-pulse rounded-2xl border border-surface-line bg-surface-subtle" />
          <div className="h-48 animate-pulse rounded-2xl border border-surface-line bg-surface-subtle" />
        </div>
        <div className="mt-8 flex justify-center">
          <div className="h-2 w-20 animate-pulse rounded-full bg-surface-line" />
        </div>
      </div>
      <span className="sr-only">載入中…</span>
    </main>
  );
}
