"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseBalanceInput, type Account, type AccountKind } from "@/lib/accounts";
import { addAccount, updateAccount } from "./actions";

const PALETTE = ["#d85700", "#f2a65a", "#8c3b00", "#b8865a", "#6b7280", "#9ca3af", "#4b5563", "#d1a37a"];

export function AccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("liquid");
  const [color, setColor] = useState(PALETTE[0]);
  const [originalAmount, setOriginalAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(account?.name ?? "");
    setKind(account?.kind ?? "liquid");
    setColor(account?.color ?? PALETTE[0]);
    setOriginalAmount(account?.original_amount !== null && account?.original_amount !== undefined ? String(account.original_amount) : "");
    setError(null);
  }, [account, open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const parsedOriginal = originalAmount.trim() === "" ? null : parseBalanceInput(originalAmount);
    if (originalAmount.trim() !== "" && parsedOriginal === null) {
      setError("Enter a valid original amount.");
      return;
    }
    setSaving(true);
    const payload = { name, kind, color, original_amount: kind === "loan" ? parsedOriginal : null };
    const result = account ? await updateAccount(account.id, payload) : await addAccount(payload);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? "Edit account" : "Add account"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="account-name">Name</Label>
            <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="account-kind">Type</Label>
              <select
                id="account-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as AccountKind)}
                className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="liquid">Liquid</option>
                <option value="retirement">Retirement</option>
                <option value="loan">Loan</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-color">Color</Label>
              <Input id="account-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          {kind === "loan" && (
            <div className="grid gap-1.5">
              <Label htmlFor="account-original">Original loan amount</Label>
              <Input
                id="account-original"
                value={originalAmount}
                onChange={(e) => setOriginalAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : account ? "Save changes" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
