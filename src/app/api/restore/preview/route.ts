import { getHousehold, requireUser } from "@/lib/session";
import { parseRestoreJson, RESTORE_MAX_BYTES, restoredHouseholdName } from "@/lib/restore";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  await requireUser();
  const membership = await getHousehold();
  if (!membership) {
    return Response.json({ error: "You are not a member of a household." }, { status: 401 });
  }
  if (membership.role !== "owner") {
    return Response.json({ error: "Only household owners can restore a backup." }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > RESTORE_MAX_BYTES) {
    return Response.json({ error: "The backup file is too large (over 25 MB)." }, { status: 413 });
  }

  const text = await request.text();
  if (text.length > RESTORE_MAX_BYTES) {
    return Response.json({ error: "The backup file is too large (over 25 MB)." }, { status: 413 });
  }

  const validation = parseRestoreJson(text);
  if (!validation.ok) {
    return Response.json({ error: "The backup failed validation.", errors: validation.errors }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: currentHousehold } = await supabase
    .from("households")
    .select("name")
    .eq("id", membership.household_id)
    .maybeSingle();

  return Response.json({
    mode: "new-household",
    preview: {
      householdName: validation.payload.household.name,
      newHouseholdName: restoredHouseholdName(
        validation.payload.household.name,
        validation.payload.exported_at
      ),
      exportedAt: validation.payload.exported_at,
      counts: validation.counts,
      warnings: validation.warnings,
    },
    currentHousehold: currentHousehold?.name ?? "",
  });
}
