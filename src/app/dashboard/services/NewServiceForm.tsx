"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CASE_CATEGORIES,
  CASE_CATEGORY_LABELS,
} from "@/shared/constants/categories.ts";
import type { CaseCategory } from "@/shared/types/domain.types";

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border p-4">
      <h2 className="text-lg font-medium">新增服務項目</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          分類
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as CaseCategory)}
            className="rounded border px-2 py-1"
          >
            {CASE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CASE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          子類型
          <input
            required
            value={subtype}
            onChange={(event) => setSubtype(event.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          單位
          <input
            required
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          基礎價格
          <input
            required
            type="number"
            min="1"
            value={basePrice}
            onChange={(event) => setBasePrice(event.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          包含服務（選填）
          <input
            value={includes}
            onChange={(event) => setIncludes(event.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "新增中…" : "新增"}
      </button>
    </form>
  );
}
