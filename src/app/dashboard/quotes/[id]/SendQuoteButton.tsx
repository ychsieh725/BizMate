"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_ROUTES } from "@/shared/constants/routes.ts";

/**
 * 已確認報價的寄送按鈕。
 * 僅在 quote.status === "confirmed" 時由詳情頁掛載——待審與已寄出的報價
 * 不需要（也不允許）這個動作。與 QuoteActions（awaiting_review 專用）分開，
 * 兩者的關注點與 pending 狀態不共用。
 */
export function SendQuoteButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSend(): Promise<void> {
    if (!window.confirm("確定要將最終報價單寄給客戶嗎？")) {
      return;
    }

    setPending(true);
    setError("");
    try {
      const res = await fetch(API_ROUTES.dashboardQuoteSend(quoteId), {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "寄送失敗");
        return;
      }
      router.refresh();
    } catch {
      setError("網路異常，請稍後再試");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card-float flex flex-col gap-3 rounded-[24px] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-medium">寄送報價單</h2>
      <div>
        <button
          type="button"
          data-testid="quote-send"
          onClick={handleSend}
          disabled={pending}
          className="bg-ink text-surface rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
        >
          {pending ? "寄送中…" : "寄送給客戶"}
        </button>
      </div>
      {error !== "" && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
