"use client";

import { useState } from "react";
import { PAGE_ROUTES, API_ROUTES } from "@/shared/constants/routes.ts";

type Props = { initialDisplayName: string; initialSlug: string };

export function SettingsForm({ initialDisplayName, initialSlug }: Props) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [slug, setSlug] = useState(initialSlug);
  const [savedSlug, setSavedSlug] = useState(initialSlug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const res = await fetch(API_ROUTES.dashboardSettings, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: displayName, public_slug: slug }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "儲存失敗");
        return;
      }
      setSavedSlug(json.data.public_slug);
      setSuccess(true);
    } catch {
      setError("網路異常，請稍後再試");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
      <div className="flex flex-col gap-1">
        <label htmlFor="display_name" className="text-sm font-medium text-ink">
          商家名稱
        </label>
        <input
          id="display_name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={saving}
          className="h-10 rounded-xl border border-surface-line bg-surface px-3 text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="public_slug" className="text-sm font-medium text-ink">
          分享連結代號
        </label>
        <input
          id="public_slug"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          disabled={saving}
          aria-describedby="slug-preview"
          className="h-10 rounded-xl border border-surface-line bg-surface px-3 text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
        />
        <p id="slug-preview" className="text-xs text-ink-faint">
          目前連結：{PAGE_ROUTES.quoteWizard(savedSlug)}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {success && <p className="text-sm text-status-sent-fg">已儲存</p>}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-10 items-center justify-center self-start rounded-xl bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
      >
        {saving ? "儲存中…" : "儲存"}
      </button>
    </form>
  );
}
