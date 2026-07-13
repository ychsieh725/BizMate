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
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="text-lg font-medium">終審操作</h2>

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
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
            className="w-40 rounded border px-2 py-1 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          {pending === "save" ? "儲存中…" : "儲存金額"}
        </button>
        <button
          type="button"
          data-testid="quote-confirm"
          onClick={handleConfirm}
          disabled={busy}
          className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
        >
          {pending === "confirm" ? "確認中…" : "確認報價"}
        </button>
      </div>

      <p className="text-xs text-gray-600">
        調整金額後，差額會以「商家手動調整」列入費用明細，客戶看到的明細加總與總額一致。
      </p>

      {error !== "" && (
        <p id="quote-amount-error" role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
