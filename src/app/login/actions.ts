"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

export async function authenticate(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const mode = formData.get("mode") === "signup" ? "signup" : "signin";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();

  if (mode === "signin") {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    if (data.user) {
      await supabase.from("profiles").upsert(
        { user_id: data.user.id, display_name: email.split("@")[0] ?? null, theme: "system" },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
    }
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  if (data.session && data.user) {
    await supabase.from("profiles").upsert(
      { user_id: data.user.id, display_name: email.split("@")[0] ?? null, theme: "system" },
      { onConflict: "user_id", ignoreDuplicates: true }
    );
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  return { message: "Account created. Check your email to confirm, then sign in." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
