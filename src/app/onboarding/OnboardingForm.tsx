"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function OnboardingForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const res = await fetch("/api/dashboard/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error ?? "發生未預期的錯誤，請稍後再試");
        setIsPending(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("網路異常，請稍後再試");
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="display_name" className="text-sm font-medium">
          商家名稱
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="rounded border px-3 py-2"
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        data-testid="onboarding-submit"
        disabled={isPending}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "建立中…" : "開始使用"}
      </button>
    </form>
  );
}
