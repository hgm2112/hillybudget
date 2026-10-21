"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RESTORE_DATA_TABLES, RESTORE_MAX_BYTES, type RestoreDataTable } from "@/lib/restore";

type RestorePreview = {
  householdName: string;
  exportedAt: string;
  counts: Record<RestoreDataTable, number>;
  warnings: string[];
};

export function RestoreClient() {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [currentHousehold, setCurrentHousehold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorList, setErrorList] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setErrorList([]);
    setPreview(null);
    if (file.size > RESTORE_MAX_BYTES) {
      setError("The backup file is too large (over 25 MB).");
      return;
    }
    setBusy(true);
    setFileName(file.name);
    try {
      const response = await fetch("/api/restore/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await file.text(),
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
    } catch {
      setError("The backup could not be validated.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPreview(null);
    setError(null);
    setErrorList([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-lg font-semibold">Restore from backup</h2>
        <p className="text-sm text-muted-foreground">
          Upload a Hillybudget backup file to recover your data. Restoring creates a{" "}
          <span className="font-medium text-foreground">brand-new household owned by you</span> and fills it
          with the backed-up data — nothing in your current household
          {currentHousehold ? ` (${currentHousehold})` : ""} is touched. Other members join the restored
          household with its fresh invite code.
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
              setError(null);
              setErrorList([]);
              if (file) handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <FileUp className="size-4" /> {busy ? "Validating…" : "Choose backup file"}
          </Button>
          {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          {preview && (
            <Button type="button" variant="outline" onClick={reset}>
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
            <p className="text-xs text-muted-foreground">
              Validation passed. Restore execution requires the restore migration (next phase) —{" "}
              <span className="text-foreground">no data has been changed.</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
