import Link from "next/link";
import { getHousehold, requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BackupClient } from "./backup-client";
import { HouseholdCard } from "./household-card";
import { ImportClient } from "./import-client";
import { RestoreClient } from "./restore-client";

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
  const currentId = membership.household_id;

  const [{ data: memberships }, { data: currentRow }] = await Promise.all([
    supabase.from("household_members").select("household_id, role").eq("user_id", user.id),
    supabase
      .from("households")
      .select("id, name, invite_code, owner_id")
      .eq("id", currentId)
      .maybeSingle(),
  ]);

  const householdIds = (memberships ?? []).map((row) => row.household_id);
  const { data: householdRows } = householdIds.length
    ? await supabase
        .from("households")
        .select("id, name, owner_id")
        .in("id", householdIds)
    : { data: [] as { id: string; name: string; owner_id: string }[] | null };
  const rowById = new Map((householdRows ?? []).map((row) => [row.id, row]));

  const families = householdIds
    .map((id) => {
      const row = rowById.get(id);
      if (!row) return null;
      return {
        id,
        name: row.name,
        owner: row.owner_id === user.id,
        current: id === currentId,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const { data: memberRows } = await supabase
    .from("household_members")
    .select("user_id, role")
    .eq("household_id", currentId);
  const memberIds = (memberRows ?? []).map((row) => row.user_id);
  const { data: profileRows } = memberIds.length
    ? await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", memberIds)
    : { data: [] as { user_id: string; display_name: string | null }[] | null };
  const nameByUser = new Map(
    (profileRows ?? []).map((row) => [row.user_id, row.display_name as string | null])
  );

  const members = (memberRows ?? []).map((row) => ({
    userId: row.user_id,
    role: row.role as string,
    displayName: nameByUser.get(row.user_id) ?? null,
    isYou: row.user_id === user.id,
  }));

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your family, import an Excel workbook and download household backups.
        </p>
      </div>
      <HouseholdCard
        familyName={currentRow?.name ?? "Household"}
        inviteCode={currentRow?.invite_code ?? ""}
        yourRole={membership.role}
        yourDisplayName={nameByUser.get(user.id) ?? ""}
        families={families}
        members={members}
      />
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
