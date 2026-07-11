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
        <label htmlFor="display_name" className="text-sm font-medium">
          商家名稱
        </label>
        <input
          id="display_name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={saving}
          className="rounded border px-3 py-2 disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="public_slug" className="text-sm font-medium">
          分享連結代號
        </label>
        <input
          id="public_slug"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          disabled={saving}
          aria-describedby="slug-preview"
          className="rounded border px-3 py-2 disabled:opacity-50"
        />
        <p id="slug-preview" className="text-xs text-gray-500">
          目前連結：{PAGE_ROUTES.quoteWizard(savedSlug)}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {success && <p className="text-sm text-green-600">已儲存</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded border px-4 py-2 disabled:opacity-50"
      >
        {saving ? "儲存中…" : "儲存"}
      </button>
    </form>
  );
}
