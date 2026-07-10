"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/serverClient.ts";

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
