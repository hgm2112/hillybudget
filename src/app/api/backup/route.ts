import { getHousehold, requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  BACKUP_APP,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  backupFilename,
  normalizeBackupRow,
  type BackupPayload,
  type BackupRow,
  type BackupTable,
} from "@/lib/backup";

export async function GET() {
  await requireUser();
  const membership = await getHousehold();
  if (!membership) {
    return Response.json({ error: "You are not a member of a household." }, { status: 401 });
  }

  const supabase = await createClient();
  const tables: Partial<Record<BackupTable, BackupRow[]>> = {};

  try {
    await Promise.all(
      BACKUP_TABLES.map(async (table) => {
        const { data, error } = await supabase.from(table).select("*");
        if (error) throw new Error(`${table}: ${error.message}`);
        tables[table] = (data ?? []).map((row) => normalizeBackupRow(table, row));
      })
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Backup generation failed." },
      { status: 500 }
    );
  }

  const household = tables.households?.[0];
  if (!household) {
    return Response.json({ error: "Household record not found." }, { status: 404 });
  }

  for (const row of tables.households ?? []) delete row.invite_code;

  const payload: BackupPayload = {
    app: BACKUP_APP,
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    household: {
      id: String(household.id),
      name: String(household.name ?? ""),
      owner_id: String(household.owner_id ?? ""),
    },
    tables: tables as BackupPayload["tables"],
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${backupFilename()}"`,
      "cache-control": "no-store",
    },
  });
}
