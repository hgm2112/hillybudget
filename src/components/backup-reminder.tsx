"use client";

import Link from "next/link";
import { backupAgeInDays } from "@/lib/backup";
import { useLastBackup } from "@/lib/use-last-backup";

export function BackupReminder({ householdId }: { householdId: string }) {
  const stored = useLastBackup(householdId);
  const days = stored ? backupAgeInDays(stored) : null;

  if (days === null) return null;

  return (
    <p className="text-sm text-muted-foreground">
      Backup is {days} {days === 1 ? "day" : "days"} old — download a fresh copy from{" "}
      <Link href="/settings" className="underline hover:text-foreground">
        Settings → Data &amp; Backups
      </Link>
      .
    </p>
  );
}
