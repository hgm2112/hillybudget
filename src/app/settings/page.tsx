import Link from "next/link";
import { getHousehold, requireUser } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BackupClient } from "./backup-client";
import { ImportClient } from "./import-client";

export default async function SettingsPage() {
  await requireUser();
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

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Import an Excel workbook and download household backups.
        </p>
      </div>
      <BackupClient householdId={membership.household_id} />
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
