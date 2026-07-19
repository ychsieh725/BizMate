"use client";

import { useActionState } from "react";
import { signupAction, type SignupState } from "./actions.ts";

const INITIAL_STATE: SignupState = { error: null, verificationSent: false };

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(
    signupAction,
    INITIAL_STATE,
  );

  if (state.verificationSent) {
    return (
      <p
        data-testid="signup-verification-sent"
        className="max-w-sm text-center text-sm text-ink-soft"
      >
        請檢查你的信箱，點擊驗證連結後即可登入。
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-xl border border-surface-line px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-ink">
          密碼
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className="rounded-xl border border-surface-line px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>
      {state.error !== null && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        data-testid="signup-submit"
        disabled={isPending}
        className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {isPending ? "註冊中…" : "註冊"}
      </button>
    </form>
  );
}
