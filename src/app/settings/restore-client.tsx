"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RESTORE_DATA_TABLES, RESTORE_MAX_BYTES, type RestoreDataTable } from "@/lib/restore";
import { switchHousehold } from "./actions";

type RestorePreview = {
  householdName: string;
  newHouseholdName: string;
  exportedAt: string;
  counts: Record<RestoreDataTable, number>;
  warnings: string[];
};

type RestoreResult = {
  householdId: string;
  householdName: string;
  inviteCode: string;
  counts: Record<string, number>;
};

export function RestoreClient() {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const [currentHousehold, setCurrentHousehold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorList, setErrorList] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setError(null);
    setErrorList([]);
    setPreview(null);
    setRestored(null);
    setFileText("");
    if (file.size > RESTORE_MAX_BYTES) {
      setError("The backup file is too large (over 25 MB).");
      return;
    }
    setBusy(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      const response = await fetch("/api/restore/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      const body = (await response.json()) as {
        preview?: RestorePreview;
        currentHousehold?: string;
        error?: string;
        errors?: string[];
      };
      if (!response.ok || !body.preview) {
        setError(body.error ?? "The backup could not be validated.");
        setErrorList(body.errors ?? []);
        return;
      }
      setPreview(body.preview);
      setCurrentHousehold(body.currentHousehold ?? "");
      setFileText(text);
    } catch {
      setError("The backup could not be validated.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!preview || !fileText) return;
    setError(null);
    setErrorList([]);
    setRestoring(true);
    try {
      const response = await fetch("/api/restore/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: fileText,
      });
      const body = (await response.json()) as {
        restored?: RestoreResult;
        error?: string;
        errors?: string[];
      };
      if (!response.ok || !body.restored) {
        setError(body.error ?? "The restore could not be completed.");
        setErrorList(body.errors ?? []);
        return;
      }
      setRestored(body.restored);
    } catch {
      setError("The restore could not be completed.");
    } finally {
      setRestoring(false);
    }
  }

  async function switchToRestored() {
    if (!restored) return;
    setSwitching(true);
    const ok = await switchHousehold(restored.householdId);
    if (!ok) {
      setSwitching(false);
      setError("Could not switch to the restored household.");
      return;
    }
    window.setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 0);
  }

  function reset() {
    setPreview(null);
    setRestored(null);
    setFileText("");
    setError(null);
    setErrorList([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  if (restored) {
    const recordCount = Object.values(restored.counts).reduce((sum, count) => sum + count, 0);
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">Restore complete</h2>
          <p className="text-sm text-muted-foreground">
            Restored {recordCount} records into a new household{" "}
            <span className="font-medium text-foreground">“{restored.householdName}”</span>. Your
            previous household{currentHousehold ? ` (${currentHousehold})` : ""} is untouched.
          </p>
          <p className="text-sm text-muted-foreground">
            Invite code for the new household:{" "}
            <span className="font-bold text-foreground">{restored.inviteCode}</span> — share it from
            the household screen whenever you want to invite someone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={switching} onClick={switchToRestored}>
              {switching ? "Switching…" : "Switch to restored household"}
            </Button>
            <Button type="button" variant="outline" disabled={switching} onClick={reset}>
              Done
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Until you switch, the app keeps showing your existing household. Switching only changes
            what you see — no data moves.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-lg font-semibold">Restore from backup</h2>
        <p className="text-sm text-muted-foreground">
          Upload a Hillybudget backup file to recover your data. Restoring creates a{" "}
          <span className="font-medium text-foreground">brand-new household owned by you</span> and fills it
          with the backed-up data — nothing in your current household
          {currentHousehold ? ` (${currentHousehold})` : ""} is touched.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreview(null);
              setRestored(null);
              setFileText("");
              setError(null);
              setErrorList([]);
              if (file) handleFile(file);
            }}
            disabled={preview !== null}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || restoring || preview !== null}
            onClick={() => fileRef.current?.click()}
          >
            <FileUp className="size-4" /> {busy ? "Validating…" : "Choose backup file"}
          </Button>
          {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          {preview && (
            <Button type="button" variant="outline" disabled={restoring} onClick={reset}>
              Clear
            </Button>
          )}
        </div>
        {error && (
          <div className="space-y-1">
            <p className="text-sm text-destructive">{error}</p>
            {errorList.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {errorList.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {preview && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-heading text-sm font-semibold">
                Backup of “{preview.householdName}”
              </p>
              <p className="text-xs text-muted-foreground">
                exported {new Date(preview.exportedAt).toLocaleString()}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-lg border bg-background p-3 sm:grid-cols-3">
              {RESTORE_DATA_TABLES.map((table) => (
                <span key={table} className="text-xs tabular-nums">
                  {table.replace(/_/g, " ")}: {preview.counts[table]}
                </span>
              ))}
            </div>
            {preview.warnings.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <p className="text-sm text-foreground">
              Confirming creates a <span className="font-medium">new household</span> named{" "}
              <span className="font-medium">“{preview.newHouseholdName}”</span> with this data. Your
              current household stays exactly as-is.
            </p>
            <Button type="button" disabled={restoring} onClick={confirmRestore}>
              {restoring ? "Restoring…" : "Restore as New Household"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
