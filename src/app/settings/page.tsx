"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveHousehold } from "@/lib/household";
import { money } from "@/lib/money";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ImportIssue, ProposedEntry } from "@/lib/import/types";

type AccountType = "liquid" | "retirement" | "loan";
type CategoryType = "expense" | "income";

type PreviewCategory = {
  name: string;
  type: CategoryType;
  color: string;
  exists: boolean;
};

type PreviewCard = {
  name: string;
  color: string;
  exists: boolean;
};

type PreviewAccount = {
  name: string;
  type: AccountType;
  color: string;
  balanceCount: number;
  exists: boolean;
};

type PreviewData = {
  sourceFileName: string;
  sheets: string[];
  monthRange: string;
  entriesByMonth: Record<string, number>;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  categories: PreviewCategory[];
  cards: PreviewCard[];
  accounts: PreviewAccount[];
  counts: {
    categories: number;
    cards: number;
    accounts: number;
    entries: number;
    balances: number;
  };
  sampleEntries: ProposedEntry[];
};

type PreviewResponse = {
  preview: PreviewData;
  duplicates: { entries: number; balances: number };
};

type ImportResult = {
  batch_id: string;
  duplicate_request: boolean;
  entries_inserted: number;
  entries_skipped_duplicates: number;
  balances_inserted: number;
  balances_updated: number;
  balances_skipped: number;
  categories_created: number;
  cards_created: number;
  accounts_created: number;
  warnings: ImportIssue[];
};

export default function SettingsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [status, setStatus] = useState<"loading" | "ready" | "no-household" | "not-owner">("loading");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [duplicates, setDuplicates] = useState({ entries: 0, balances: 0 });
  const [categoryTypes, setCategoryTypes] = useState<Record<string, CategoryType>>({});
  const [accountTypes, setAccountTypes] = useState<Record<string, AccountType>>({});
  const [balancesMode, setBalancesMode] = useState<"skip" | "replace">("skip");
  const [busy, setBusy] = useState<"idle" | "preview" | "import">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }
      const membership = await resolveHousehold(supabase, userData.user.id);
      if (!active) return;
      if (!membership) {
        setStatus("no-household");
        return;
      }
      setStatus(membership.role === "owner" ? "ready" : "not-owner");
    }
    init();
    return () => {
      active = false;
    };
  }, [router, supabase]);

  const entryMonths = useMemo(() => {
    if (!preview) return [];
    return Object.entries(preview.entriesByMonth).sort(([a], [b]) => a.localeCompare(b));
  }, [preview]);

  function resetPreview() {
    setPreview(null);
    setResult(null);
    setError(null);
    setDuplicates({ entries: 0, balances: 0 });
    setCategoryTypes({});
    setAccountTypes({});
    setBalancesMode("skip");
  }

  async function runPreview() {
    if (!file) return;
    setBusy("preview");
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/import/preview", { method: "POST", body: formData });
      const body = (await response.json()) as PreviewResponse & { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not preview the workbook");
        setPreview(null);
        return;
      }
      setPreview(body.preview);
      setDuplicates(body.duplicates);
      setCategoryTypes(
        Object.fromEntries(body.preview.categories.map((category) => [category.name, category.type]))
      );
      setAccountTypes(
        Object.fromEntries(body.preview.accounts.map((account) => [account.name, account.type]))
      );
    } catch {
      setError("Could not preview the workbook");
      setPreview(null);
    } finally {
      setBusy("idle");
    }
  }

  async function runImport() {
    if (!file || !preview) return;
    setBusy("import");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("categoryTypes", JSON.stringify(categoryTypes));
      formData.append("accountTypes", JSON.stringify(accountTypes));
      formData.append("balancesMode", balancesMode);
      const response = await fetch("/api/import/confirm", { method: "POST", body: formData });
      const body = (await response.json()) as { result?: ImportResult; error?: string };
      if (!response.ok || !body.result) {
        setError(body.error ?? "Could not import the workbook");
        return;
      }
      setResult(body.result);
      setPreview(null);
    } catch {
      setError("Could not import the workbook");
    } finally {
      setBusy("idle");
    }
  }

  if (status === "loading") return <main className="p-8">Loading...</main>;
  if (status === "no-household") {
    return (
      <main className="mx-auto max-w-3xl p-4 md:p-8">
        <Card><CardContent className="p-6 space-y-3">
          <h1 className="text-xl font-semibold">Import</h1>
          <p className="text-sm text-muted-foreground">Create or join a household before importing expenses.</p>
          <Link href="/household" className={buttonVariants()}>Go to household</Link>
        </CardContent></Card>
      </main>
    );
  }
  if (status === "not-owner") {
    return (
      <main className="mx-auto max-w-3xl p-4 md:p-8">
        <Card><CardContent className="p-6 space-y-3">
          <h1 className="text-xl font-semibold">Import</h1>
          <p className="text-sm text-muted-foreground">Only household owners can import expenses.</p>
        </CardContent></Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Import</h1>
        <p className="text-sm text-muted-foreground">Import categories, cards, accounts, balances and monthly expenses from an Excel workbook.</p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <Label htmlFor="workbook">Excel workbook (.xlsx)</Label>
            <Input
              id="workbook"
              type="file"
              accept=".xlsx"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                resetPreview();
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={runPreview} disabled={!file || busy !== "idle"}>
              {busy === "preview" ? "Reading..." : "Preview import"}
            </Button>
            {file && <span className="self-center text-sm text-muted-foreground">{file.name}</span>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Import complete</h2>
              {result.duplicate_request && <Badge variant="secondary">already imported</Badge>}
            </div>
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <div>Entries inserted: {result.entries_inserted}</div>
              <div>Duplicate entries skipped: {result.entries_skipped_duplicates}</div>
              <div>Categories created: {result.categories_created}</div>
              <div>Cards created: {result.cards_created}</div>
              <div>Accounts created: {result.accounts_created}</div>
              <div>Balances inserted: {result.balances_inserted}</div>
              <div>Balances updated: {result.balances_updated}</div>
              <div>Balances skipped: {result.balances_skipped}</div>
            </div>
            <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>View expenses</Link>
          </CardContent>
        </Card>
      )}

      {preview && (
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-lg font-semibold">Preview</h2>
              <div className="grid gap-2 text-sm md:grid-cols-5">
                <div>Categories: {preview.counts.categories}</div>
                <div>Cards: {preview.counts.cards}</div>
                <div>Accounts: {preview.counts.accounts}</div>
                <div>Entries: {preview.counts.entries}</div>
                <div>Balances: {preview.counts.balances}</div>
              </div>
              <p className="text-sm text-muted-foreground">
                Months: {preview.monthRange || "none"} · Sheets: {preview.sheets.join(", ")}
              </p>
              {entryMonths.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Entries per month</summary>
                  <div className="mt-2 grid gap-1 md:grid-cols-4">
                    {entryMonths.map(([month, count]) => (
                      <div key={month} className="flex justify-between gap-4">
                        <span>{month.slice(0, 7)}</span>
                        <span className="tabular-nums">{count}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <p className="text-sm">
                Duplicate entries already imported: <span className="tabular-nums">{duplicates.entries}</span> · Balance conflicts:{" "}
                <span className="tabular-nums">{duplicates.balances}</span>
              </p>
              {preview.errors.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {preview.errors.slice(0, 20).map((issue, index) => (
                    <div key={index}>{issue.source}: {issue.message}</div>
                  ))}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  {preview.warnings.slice(0, 20).map((issue, index) => (
                    <div key={index}>{issue.message}</div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-lg font-semibold">Categories ({preview.categories.length})</h2>
              <div className="max-h-80 space-y-2 overflow-auto pr-2">
                {preview.categories.map((category) => (
                  <div key={category.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
                      <span>{category.name}</span>
                      {category.exists ? <Badge variant="secondary">existing</Badge> : <Badge>new</Badge>}
                    </div>
                    <select
                      value={categoryTypes[category.name] ?? category.type}
                      onChange={(event) =>
                        setCategoryTypes((state) => ({ ...state, [category.name]: event.target.value as CategoryType }))
                      }
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="expense">expense</option>
                      <option value="income">income</option>
                    </select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-lg font-semibold">Accounts ({preview.accounts.length})</h2>
              <div className="space-y-2">
                {preview.accounts.map((account) => (
                  <div key={account.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span>{account.name}</span>
                      <span className="text-xs text-muted-foreground">{account.balanceCount} balances</span>
                      {account.exists ? <Badge variant="secondary">existing</Badge> : <Badge>new</Badge>}
                    </div>
                    <select
                      value={accountTypes[account.name] ?? account.type}
                      onChange={(event) =>
                        setAccountTypes((state) => ({ ...state, [account.name]: event.target.value as AccountType }))
                      }
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="liquid">liquid</option>
                      <option value="retirement">retirement</option>
                      <option value="loan">loan</option>
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="balances-mode">Existing balances</Label>
                <select
                  id="balances-mode"
                  value={balancesMode}
                  onChange={(event) => setBalancesMode(event.target.value as "skip" | "replace")}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="skip">Keep existing (skip)</option>
                  <option value="replace">Overwrite from workbook</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-lg font-semibold">Sample entries ({preview.sampleEntries.length} of {preview.counts.entries})</h2>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1">Month</th>
                      <th className="py-1">Category</th>
                      <th className="py-1">Card</th>
                      <th className="py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleEntries.map((entry, index) => (
                      <tr key={index} className="border-t">
                        <td className="py-1">{entry.month.slice(0, 7)}</td>
                        <td className="py-1">{entry.category}</td>
                        <td className="py-1">{entry.card ?? "-"}</td>
                        <td className="py-1 text-right tabular-nums">{money(entry.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={runImport} disabled={busy !== "idle" || preview.errors.length > 0}>
              {busy === "import" ? "Importing..." : "Confirm import"}
            </Button>
            {preview.errors.length > 0 && (
              <span className="text-sm text-red-600">Fix the workbook errors before importing.</span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
