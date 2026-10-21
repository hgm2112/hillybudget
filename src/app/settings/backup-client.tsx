"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  BACKUP_TABLES,
  backupFilename,
  countBackupRecords,
  type BackupPayload,
} from "@/lib/backup";
import { useLastBackup, writeLastBackup } from "@/lib/use-last-backup";

export function BackupClient({ householdId }: { householdId: string }) {
  const lastBackup = useLastBackup(householdId);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Backup failed (HTTP ${response.status}).`);
      }
      const payload = (await response.json()) as BackupPayload;

      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = backupFilename(new Date(payload.exported_at));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const now = new Date().toISOString();
      writeLastBackup(householdId, now);
      setStatus(
        `Backup downloaded — ${countBackupRecords(payload)} records across ${BACKUP_TABLES.length} tables. Keep it somewhere private.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-lg font-semibold">Data &amp; Backups</h2>
        <p className="text-sm text-muted-foreground">
          Back Up Now downloads a JSON snapshot of your whole household: expense and income entries,
          account balance history, categories and groups, cards, recurring items, settings, and
          skipped months. It is generated through your authenticated Supabase session and saved
          directly to your computer — nothing is stored on the server.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={busy}>
            <Download className="size-4" /> Back Up Now
          </Button>
          <span className="text-sm text-muted-foreground">
            Last backup: {lastBackup ? new Date(lastBackup).toLocaleString() : "never"}
          </span>
        </div>
        {status && <p className="text-sm text-green-600">{status}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          The file contains your full financial history in plain JSON. Keep it in a private location
          (an encrypted folder or personal vault), and remember: a successful download is not the
          same as a verified off-site backup.
        </p>
      </CardContent>
    </Card>
  );
}
