"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_ROUTES } from "@/shared/constants/routes.ts";

/**
 * 待審報價的操作區（調金額 + 確認）。
 * 僅在 quote.status === "awaiting_review" 時由詳情頁掛載——
 * 已確認/已寄出的報價是唯讀的，不渲染本元件。
 */
export function QuoteActions({
  quoteId,
  initialAmount,
}: {
  quoteId: string;
  initialAmount: number | null;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(initialAmount ?? ""));
  const [pending, setPending] = useState<"none" | "save" | "confirm">("none");
  const [error, setError] = useState("");

  async function handleSave(): Promise<void> {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("金額須為正數");
      return;
    }

    setPending("save");
    setError("");
    try {
      const res = await fetch(API_ROUTES.dashboardQuote(quoteId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ final_amount: parsed }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "儲存失敗");
        return;
      }
      router.refresh();
    } catch {
      setError("網路異常，請稍後再試");
    } finally {
      setPending("none");
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!window.confirm("確認後將無法再調整金額，確定要確認這張報價嗎？")) {
      return;
    }

    setPending("confirm");
    setError("");
    try {
      const res = await fetch(API_ROUTES.dashboardQuoteConfirm(quoteId), {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "確認失敗");
        return;
      }
      router.refresh();
    } catch {
      setError("網路異常，請稍後再試");
    } finally {
      setPending("none");
    }
  }

  const busy = pending !== "none";

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-surface-line bg-surface shadow-card p-5">
      <h2 className="text-lg font-medium text-ink">終審操作</h2>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink-soft">
          最終金額（NT$）
          <input
            type="number"
            data-testid="quote-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={busy}
            min={1}
            step={1}
            aria-invalid={error !== ""}
            aria-describedby={error !== "" ? "quote-amount-error" : undefined}
            className="h-10 w-40 rounded-xl border border-surface-line bg-surface px-3 font-mono tabular-nums text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50 aria-invalid:border-danger"
          />
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-surface-line px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
        >
          {pending === "save" ? "儲存中…" : "儲存金額"}
        </button>
        <button
          type="button"
          data-testid="quote-confirm"
          onClick={handleConfirm}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
        >
          {pending === "confirm" ? "確認中…" : "確認報價"}
        </button>
      </div>

      <p className="text-xs text-ink-soft">
        調整金額後，差額會以「商家手動調整」列入費用明細，客戶看到的明細加總與總額一致。
      </p>

      {error !== "" && (
        <p id="quote-amount-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
