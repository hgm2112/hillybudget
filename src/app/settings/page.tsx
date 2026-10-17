import Link from "next/link";
import { getHousehold, requireUser } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ImportClient } from "./import-client";

export default async function SettingsPage() {
  await requireUser();
  const membership = await getHousehold();

  if (!membership) {
    return (
      <main className="mx-auto max-w-3xl p-4 md:p-8">
        <Card>
          <CardContent className="space-y-3 p-6">
            <h1 className="text-xl font-semibold">Import</h1>
            <p className="text-sm text-muted-foreground">Create or join a household before importing expenses.</p>
            <Link href="/household" className={buttonVariants()}>Go to household</Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (membership.role !== "owner") {
    return (
      <main className="mx-auto max-w-3xl p-4 md:p-8">
        <Card>
          <CardContent className="space-y-3 p-6">
            <h1 className="text-xl font-semibold">Import</h1>
            <p className="text-sm text-muted-foreground">Only household owners can import expenses.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Import</h1>
        <p className="text-sm text-muted-foreground">
          Import categories, cards, accounts, balances and monthly expenses from an Excel workbook.
        </p>
      </div>
      <ImportClient />
    </main>
  );
}
