import type { SupabaseClient } from "@supabase/supabase-js";

export type HouseholdMembership = {
  household_id: string;
  role: string;
};

export async function resolveHousehold(
  supabase: SupabaseClient,
  userId: string
): Promise<HouseholdMembership | null> {
  const { data } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("household_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const row = data as { household_id: string; role: string };
  return { household_id: row.household_id, role: row.role };
}
