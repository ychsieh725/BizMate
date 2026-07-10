"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/serverClient.ts";
import { toFriendlyAuthError } from "@/lib/auth/authErrorMessages.ts";

export type LoginState = { error: string | null };

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (email === "" || password === "") {
    return { error: "請輸入 Email 與密碼" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: toFriendlyAuthError(error.message) };
  }

  redirect("/dashboard");
}
