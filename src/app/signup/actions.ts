"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/serverClient.ts";
import { toFriendlyAuthError } from "@/lib/auth/authErrorMessages.ts";

export type SignupState = { error: string | null; verificationSent: boolean };

export async function signupAction(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (email === "" || password === "") {
    return { error: "請輸入 Email 與密碼", verificationSent: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return {
      error: toFriendlyAuthError(error.message),
      verificationSent: false,
    };
  }

  if (data.session !== null) {
    redirect("/dashboard");
  }

  return { error: null, verificationSent: true };
}
