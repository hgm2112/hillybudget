"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type HouseholdState = { error?: string };

function formatError(error: unknown, fallback: string) {
  const err = (error ?? {}) as { message?: string; code?: string; details?: string; hint?: string };
  const parts = [err.message, err.code && `code=${err.code}`, err.details, err.hint].filter(Boolean);
  return parts.length ? parts.join(" | ") : fallback;
}

async function ensureProfile() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;
  await supabase.from("profiles").upsert(
    { user_id: user.id, display_name: user.email?.split("@")[0] ?? null, theme: "system" },
    { onConflict: "user_id", ignoreDuplicates: true }
  );
}

export async function createHousehold(_prev: HouseholdState, formData: FormData): Promise<HouseholdState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Household name is required." };

  await ensureProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_household", { household_name: name });
  if (error) return { error: formatError(error, "Failed to create household") };
  if (!data) return { error: "Failed to create household: no id returned" };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function joinHousehold(_prev: HouseholdState, formData: FormData): Promise<HouseholdState> {
  const invite = String(formData.get("code") ?? "").trim();
  if (!invite) return { error: "Invite code is required." };

  await ensureProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_household", { invite });
  if (error) return { error: formatError(error, "Failed to join household") };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
