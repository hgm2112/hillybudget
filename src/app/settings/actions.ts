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
