import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { resolveHousehold } from "@/lib/household";

export { getUser };

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function getHousehold() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return resolveHousehold(supabase, data.user.id);
}

export async function requireHousehold() {
  const membership = await getHousehold();
  if (!membership) redirect("/household");
  return membership;
}
