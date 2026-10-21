import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { resolveHousehold } from "@/lib/household";

export { getUser };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const HOUSEHOLD_COOKIE = "hillybudget:household";

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function getHousehold() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  const preference = (await cookies()).get(HOUSEHOLD_COOKIE)?.value ?? "";
  if (UUID_RE.test(preference)) {
    const { data: preferred } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", data.user.id)
      .eq("household_id", preference)
      .maybeSingle();
    if (preferred) {
      return { household_id: preferred.household_id, role: preferred.role };
    }
  }

  return resolveHousehold(supabase, data.user.id);
}

export async function requireHousehold() {
  const membership = await getHousehold();
  if (!membership) redirect("/household");
  return membership;
}
