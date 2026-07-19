"use client";

import { useState } from "react";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

type ServiceRow = Tables<"rate_card_base">;
type EditableFields = { unit: string; base_price: string; includes: string };

/** 三個可編輯欄位共用的輸入框樣式，寬度由呼叫端各自附加。 */
const CELL_INPUT_CLASS =
  "h-9 rounded-xl border border-surface-line bg-surface px-2.5 text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50";

function toEditable(item: ServiceRow): EditableFields {
  return {
    unit: item.unit,
    base_price: String(item.base_price ?? ""),
    includes: item.includes ?? "",
  };
}

function toDraftMap(items: ServiceRow[]): Record<string, EditableFields> {
  return Object.fromEntries(items.map((item) => [item.id, toEditable(item)]));
}

export function ServicesTable({ initialItems }: { initialItems: ServiceRow[] }) {
  const [items, setItems] = useState(initialItems);
  const [drafts, setDrafts] = useState(() => toDraftMap(initialItems));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  // router.refresh()（NewServiceForm 新增成功後）會讓 page.tsx 重新查詢並傳入新的
  // initialItems 參照。依 React 官方建議的「render 期間調整 state」模式同步，
  // 不用 useEffect（避免 react-hooks/set-state-in-effect：見
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes）。
  const [prevInitialItems, setPrevInitialItems] = useState(initialItems);
  if (initialItems !== prevInitialItems) {
    setPrevInitialItems(initialItems);
    setItems(initialItems);
    setDrafts(toDraftMap(initialItems));
  }

  async function refetch(): Promise<void> {
    const res = await fetch("/api/dashboard/services");
    const json = await res.json();
    if (res.ok && json.success) {
      setItems(json.data.items);
      setDrafts(toDraftMap(json.data.items));
    }
  }

  function updateDraft(id: string, patch: Partial<EditableFields>): void {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(id: string): Promise<void> {
    const draft = drafts[id];
    const basePrice = Number(draft.base_price);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      setErrorById((prev) => ({ ...prev, [id]: "基礎價格須為正數" }));
      return;
    }

    setSavingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/dashboard/services/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unit: draft.unit,
          base_price: basePrice,
          includes: draft.includes === "" ? null : draft.includes,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorById((prev) => ({ ...prev, [id]: json.error ?? "儲存失敗" }));
        return;
      }
      await refetch();
    } catch {
      setErrorById((prev) => ({ ...prev, [id]: "網路異常，請稍後再試" }));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("確定要停售這個服務項目嗎？")) return;

    setSavingId(id);
    try {
      const res = await fetch(`/api/dashboard/services/${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorById((prev) => ({ ...prev, [id]: json.error ?? "刪除失敗" }));
        return;
      }
      await refetch();
    } catch {
      setErrorById((prev) => ({ ...prev, [id]: "網路異常，請稍後再試" }));
    } finally {
      setSavingId(null);
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-ink-soft">尚無服務項目，請於下方新增。</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-surface-line text-left">
          <th className="py-2 font-normal text-ink-soft">分類</th>
          <th className="py-2 font-normal text-ink-soft">子類型</th>
          <th className="py-2 font-normal text-ink-soft">單位</th>
          <th className="py-2 font-normal text-ink-soft">基礎價格</th>
          <th className="py-2 font-normal text-ink-soft">包含服務</th>
          <th className="py-2 font-normal text-ink-soft">狀態</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const draft = drafts[item.id] ?? toEditable(item);
          const disabled = !item.is_active || savingId === item.id;
          return (
            <tr
              key={item.id}
              data-testid={`service-row-${item.id}`}
              className={`border-b border-surface-line align-top ${
                item.is_active ? "" : "opacity-40"
              }`}
            >
              <td className="py-2 text-ink">{CASE_CATEGORY_LABELS[item.category]}</td>
              <td className="py-2 text-ink">{item.subtype}</td>
              <td className="py-2">
                <input
                  value={draft.unit}
                  onChange={(event) => updateDraft(item.id, { unit: event.target.value })}
                  disabled={disabled}
                  className={`w-20 ${CELL_INPUT_CLASS}`}
                />
              </td>
              <td className="py-2">
                <input
                  type="number"
                  data-testid={`service-base-price-${item.id}`}
                  value={draft.base_price}
                  onChange={(event) =>
                    updateDraft(item.id, { base_price: event.target.value })
                  }
                  disabled={disabled}
                  className={`w-24 font-mono tabular-nums ${CELL_INPUT_CLASS}`}
                />
              </td>
              <td className="py-2">
                <input
                  value={draft.includes}
                  onChange={(event) =>
                    updateDraft(item.id, { includes: event.target.value })
                  }
                  disabled={disabled}
                  className={`w-40 ${CELL_INPUT_CLASS}`}
                />
              </td>
              <td className="py-2">
                {!item.is_active && (
                  <span className="rounded-full bg-surface-line px-2.5 py-1 text-[11px] font-medium text-ink-soft">
                    已停售
                  </span>
                )}
              </td>
              <td className="py-2">
                {item.is_active && (
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        data-testid={`service-save-${item.id}`}
                        onClick={() => handleSave(item.id)}
                        disabled={disabled}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-surface-line px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
                      >
                        {savingId === item.id ? "儲存中…" : "儲存"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        disabled={disabled}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-surface-line px-3 text-sm font-medium text-danger transition-colors hover:border-danger hover:bg-danger-soft focus:outline-none focus:ring-2 focus:ring-danger-soft disabled:opacity-50"
                      >
                        停售
                      </button>
                    </div>
                    {errorById[item.id] && (
                      <p role="alert" className="text-xs text-danger">
                        {errorById[item.id]}
                      </p>
                    )}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
