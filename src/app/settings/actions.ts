"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser, HOUSEHOLD_COOKIE } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function switchHousehold(householdId: string) {
  const user = await requireUser();
  if (!UUID_RE.test(householdId)) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!data) return false;

  const store = await cookies();
  store.set(HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  return true;
}

async function setCurrentHousehold(householdId: string) {
  const store = await cookies();
  store.set(HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export type FamilyActionState = { error?: string; ok?: string };

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
  await supabase
    .from("profiles")
    .upsert(
      { user_id: user.id, display_name: user.email?.split("@")[0] ?? null, theme: "system" },
      { onConflict: "user_id", ignoreDuplicates: true }
    );
}

export async function joinFamily(
  _prev: FamilyActionState,
  formData: FormData
): Promise<FamilyActionState> {
  const invite = String(formData.get("code") ?? "").trim();
  if (!invite) return { error: "Family code is required." };

  await requireUser();
  await ensureProfile();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_household", { invite });
  if (error) return { error: formatError(error, "Could not join that family.") };
  if (!data) return { error: "Could not join that family." };

  await setCurrentHousehold(String(data));
  revalidatePath("/", "layout");
  return { ok: "Joined. You are now in that family." };
}

export async function createFamily(
  _prev: FamilyActionState,
  formData: FormData
): Promise<FamilyActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Family name is required." };

  await requireUser();
  await ensureProfile();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_household", { household_name: name });
  if (error) return { error: formatError(error, "Could not create the family.") };
  if (!data) return { error: "Could not create the family." };

  await setCurrentHousehold(String(data));
  revalidatePath("/", "layout");
  return { ok: "Family created. You are now in it." };
}

export async function setDisplayName(
  _prev: FamilyActionState,
  formData: FormData
): Promise<FamilyActionState> {
  const name = String(formData.get("displayName") ?? "").trim();
  if (!name) return { error: "Enter a display name." };

  const user = await requireUser();
  const supabase = await createClient();
  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("user_id", user.id)
    .select("user_id")
    .maybeSingle();
  if (updateError) return { error: formatError(updateError, "Could not save your display name.") };
  if (!updated) {
    const { error: insertError } = await supabase
      .from("profiles")
      .insert({ user_id: user.id, display_name: name, theme: "system" });
    if (insertError) return { error: formatError(insertError, "Could not save your display name.") };
  }

  revalidatePath("/settings");
  return { ok: "Display name saved." };
}

export async function deleteFamily(householdId: string) {
  const user = await requireUser();
  if (!UUID_RE.test(householdId)) return { error: "Unknown family." };

  const supabase = await createClient();

  const { data: household } = await supabase
    .from("households")
    .select("id, name, owner_id")
    .eq("id", householdId)
    .maybeSingle();
  if (!household) return { error: "Unknown family." };
  if (household.owner_id !== user.id) return { error: "Only the family owner can delete it." };

  const { data: memberships } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id);
  if ((memberships ?? []).length <= 1) {
    return { error: "You need another family before you can delete this one." };
  }

  await supabase.from("ledger_entries").delete().eq("household_id", householdId);
  await supabase.from("recurring_items").delete().eq("household_id", householdId);

  const { error } = await supabase.from("households").delete().eq("id", householdId);
  if (error) return { error: formatError(error, "Could not delete the family.") };

  const store = await cookies();
  if (store.get(HOUSEHOLD_COOKIE)?.value === householdId) {
    const next = (memberships ?? []).find((row) => row.household_id !== householdId);
    if (next) await setCurrentHousehold(next.household_id);
    else store.delete(HOUSEHOLD_COOKIE);
  }

  revalidatePath("/", "layout");
  return { ok: `Deleted ${household.name}.` };
}
