/**
 * dashboard 區段共用的載入骨架。
 * 後台頁面全為動態 SSR，導覽點擊後要等伺服器把整頁算完才有回應；
 * 有了這個 Suspense 邊界，點擊瞬間就切到骨架（側欄保持不動），
 * 察覺延遲從「完整端到端時間」降為「近乎零」，同時讓 Link prefetch
 * 有可預取的靜態外殼。骨架取各頁共同輪廓（標題列 + 兩張卡片）。
 */
export default function DashboardLoading() {
  return (
    <main
      role="status"
      aria-label="頁面載入中"
      className="flex flex-1 flex-col gap-4 p-4"
    >
      <div className="h-8 w-40 animate-pulse rounded-lg bg-surface-line" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-2xl border border-surface-line bg-surface shadow-card" />
        <div className="h-28 animate-pulse rounded-2xl border border-surface-line bg-surface shadow-card" />
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-surface-line bg-surface shadow-card" />
      <span className="sr-only">載入中…</span>
    </main>
  );
}
