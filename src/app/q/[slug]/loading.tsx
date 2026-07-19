/**
 * /q/[slug] 進入頁的載入骨架。
 * page.tsx 是 server component，要先查 findBySlug 解析商家才能渲染 wizard；
 * 客戶點開商家分享連結的第一印象若是空白畫面會顯得不可靠，這個 Suspense
 * 邊界讓查詢期間立即有內容佔位，之後由真正的 WizardPage 換入。
 * 外殼尺寸對齊 WizardPage（max-w-2xl px-6 py-16），避免骨架換真內容時跳動。
 */
export default function QuoteEntryLoading() {
  return (
    <main
      role="status"
      aria-label="頁面載入中"
      className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-16"
    >
      <div className="h-4 w-32 animate-pulse rounded-md bg-surface-line" />
      <div className="flex flex-col gap-3">
        <div className="h-2 w-full animate-pulse rounded-full bg-surface-line" />
        <div className="h-7 w-3/4 animate-pulse rounded-lg bg-surface-line" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="h-16 animate-pulse rounded-2xl border border-surface-line bg-surface" />
        <div className="h-16 animate-pulse rounded-2xl border border-surface-line bg-surface" />
        <div className="h-16 animate-pulse rounded-2xl border border-surface-line bg-surface" />
      </div>
      <span className="sr-only">載入中…</span>
    </main>
  );
}
