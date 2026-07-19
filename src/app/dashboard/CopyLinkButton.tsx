"use client";

import { useState } from "react";

export function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/q/${slug}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="w-fit rounded-xl border border-surface-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-accent hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent-soft"
    >
      {copied ? "已複製！" : `複製分享連結 /q/${slug}`}
    </button>
  );
}
