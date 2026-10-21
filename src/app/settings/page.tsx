import Link from "next/link";
import { getHousehold, requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BackupClient } from "./backup-client";
import { ImportClient } from "./import-client";
import { RestoreClient } from "./restore-client";
import { SwitchHousehold } from "./switch-household";

export default async function SettingsPage() {
  const user = await requireUser();
  const membership = await getHousehold();

  if (!membership) {
    return (
      <main className="mx-auto max-w-3xl p-4 md:p-8">
        <Card>
          <CardContent className="space-y-3 p-6">
            <h1 className="text-xl font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Create or join a household before importing expenses or backing up data.
            </p>
            <Link href="/household" className={buttonVariants()}>Go to household</Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", user.id);
  const householdIds = (memberships ?? []).map((row) => row.household_id);
  const { data: householdRows } = householdIds.length
    ? await supabase.from("households").select("id, name").in("id", householdIds)
    : { data: [] as { id: string; name: string }[] | null };
  const nameById = new Map(
    (householdRows ?? []).map((row) => [row.id, row.name as string])
  );
  const households = householdIds
    .map((id) => ({ id, name: nameById.get(id) ?? "Household" }))
    .filter((row) => nameById.has(row.id));

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Import an Excel workbook and download household backups.
        </p>
      </div>
      {households.length > 1 && (
        <SwitchHousehold households={households} currentId={membership.household_id} />
      )}
      <BackupClient householdId={membership.household_id} />
      {membership.role === "owner" && <RestoreClient />}
      {membership.role === "owner" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Import</h2>
            <p className="text-sm text-muted-foreground">
              Import categories, cards, accounts, balances and monthly expenses from an Excel workbook.
            </p>
          </div>
          <ImportClient />
        </div>
      ) : (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-lg font-semibold">Import</h2>
            <p className="text-sm text-muted-foreground">
              Only household owners can import expenses.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
