import { getHousehold, requireUser } from "@/lib/session";
import { parseRestoreJson, RESTORE_MAX_BYTES } from "@/lib/restore";
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
  const { data, error } = await supabase.rpc("restore_into_new_household", {
    p_payload: validation.payload,
  });

  if (error) {
    return Response.json(
      { error: error.message || "The restore could not be completed." },
      { status: 422 }
    );
  }

  const result = data as {
    household_id?: string;
    household_name?: string;
    invite_code?: string;
    counts?: Record<string, number>;
  };

  if (!result?.household_id) {
    return Response.json({ error: "The restore returned no household." }, { status: 500 });
  }

  return Response.json({
    restored: {
      householdId: result.household_id,
      householdName: result.household_name ?? validation.payload.household.name,
      inviteCode: result.invite_code ?? "",
      counts: result.counts ?? validation.counts,
    },
  });
}
