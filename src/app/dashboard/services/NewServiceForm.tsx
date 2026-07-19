"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CASE_CATEGORIES,
  CASE_CATEGORY_LABELS,
} from "@/shared/constants/categories.ts";
import type { CaseCategory } from "@/shared/types/domain.types";

/** 表單五個欄位共用的輸入框樣式（select 與 input 一致）。 */
const FIELD_CLASS =
  "h-10 rounded-xl border border-surface-line bg-surface px-3 text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";

export function NewServiceForm() {
  const router = useRouter();
  const [category, setCategory] = useState<CaseCategory>(CASE_CATEGORIES[0]);
  const [subtype, setSubtype] = useState("");
  const [unit, setUnit] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [includes, setIncludes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const res = await fetch("/api/dashboard/services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          subtype,
          unit,
          base_price: Number(basePrice),
          includes: includes === "" ? null : includes,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error ?? "發生未預期的錯誤，請稍後再試");
        setIsPending(false);
        return;
      }

      setSubtype("");
      setUnit("");
      setBasePrice("");
      setIncludes("");
      setIsPending(false);
      router.refresh();
    } catch {
      setError("網路異常，請稍後再試");
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-ink">新增服務項目</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink-soft">
          分類
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as CaseCategory)}
            className={FIELD_CLASS}
          >
            {CASE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CASE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-soft">
          子類型
          <input
            required
            value={subtype}
            onChange={(event) => setSubtype(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-soft">
          單位
          <input
            required
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-soft">
          基礎價格
          <input
            required
            type="number"
            min="1"
            value={basePrice}
            onChange={(event) => setBasePrice(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm text-ink-soft">
          包含服務（選填）
          <input
            value={includes}
            onChange={(event) => setIncludes(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-10 items-center justify-center self-start rounded-xl bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
      >
        {isPending ? "新增中…" : "新增"}
      </button>
    </form>
  );
}
