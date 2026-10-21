"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createFamily,
  deleteFamily,
  joinFamily,
  setDisplayName,
  switchHousehold,
  type FamilyActionState,
} from "./actions";

export type FamilyOption = {
  id: string;
  name: string;
  owner: boolean;
  current: boolean;
};

export type MemberOption = {
  userId: string;
  role: string;
  displayName: string | null;
  isYou: boolean;
};

const emptyState: FamilyActionState = {};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h3 className="text-base font-bold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function HouseholdCard({
  familyName,
  inviteCode,
  yourRole,
  yourDisplayName,
  families,
  members,
}: {
  familyName: string;
  inviteCode: string;
  yourRole: string;
  yourDisplayName: string;
  families: FamilyOption[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const [joinState, joinAction, joinPending] = useActionState(joinFamily, emptyState);
  const [createState, createAction, createPending] = useActionState(createFamily, emptyState);
  const [nameState, nameAction, namePending] = useActionState(setDisplayName, emptyState);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FamilyOption | null>(null);
  const [deleteName, setDeleteName] = useState("");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the code and copy it manually.");
    }
  }

  async function go(id: string) {
    setBusy(id);
    setError(null);
    const ok = await switchHousehold(id);
    setBusy(null);
    if (ok) {
      setStatus("Switched family.");
      router.refresh();
    } else {
      setError("Could not switch to that family.");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setDeleteName("");
    setBusy(target.id);
    setError(null);
    const result = await deleteFamily(target.id);
    setBusy(null);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setStatus(result?.ok ?? "Family deleted.");
    router.refresh();
  }

  const canDelete = families.length > 1;

  return (
    <Card>
      <CardContent className="space-y-6 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Household</h2>
          <span className="text-sm text-muted-foreground">{familyName}</span>
          <Badge variant="outline">{yourRole === "owner" ? "Owner" : "Member"}</Badge>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <Section
              title="Family code"
              description="Share this code so someone can join your family."
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-base tracking-widest">
                  {inviteCode}
                </code>
                <Button type="button" variant="outline" onClick={copyCode}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </Section>

            <Section title="Who's in family">
              <ul className="space-y-1">
                {members.map((member) => (
                  <li key={member.userId} className="flex items-center gap-2 text-sm">
                    <span className="font-bold">
                      {member.displayName?.trim() || (member.isYou ? "You" : "Member")}
                    </span>
                    {member.isYou && <span className="text-muted-foreground">(you)</span>}
                    <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                      {member.role === "owner" ? "Owner" : "Member"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Section>

            <Section
              title="Your display name"
              description="This is how other people in your family see you."
            >
              <form action={nameAction} className="flex flex-wrap items-center gap-2">
                <Input
                  name="displayName"
                  defaultValue={yourDisplayName}
                  placeholder="Your name"
                  className="h-9 max-w-48"
                />
                <Button type="submit" variant="outline" disabled={namePending}>
                  {namePending ? "Saving…" : "Save"}
                </Button>
              </form>
              {nameState.error && <p className="text-sm text-destructive">{nameState.error}</p>}
              {nameState.ok && <p className="text-sm text-green-600">{nameState.ok}</p>}
            </Section>
          </div>

          <div className="space-y-6">
            <Section title="Join family" description="Enter a family code to join another family.">
              <form action={joinAction} className="flex flex-wrap items-center gap-2">
                <Input
                  name="code"
                  placeholder="Family code"
                  className="h-9 max-w-40 font-mono uppercase"
                />
                <Button type="submit" variant="outline" disabled={joinPending}>
                  {joinPending ? "Joining…" : "Join"}
                </Button>
              </form>
              {joinState.error && <p className="text-sm text-destructive">{joinState.error}</p>}
              {joinState.ok && <p className="text-sm text-green-600">{joinState.ok}</p>}
            </Section>

            <Section title="Create family" description="Start a new family with its own code.">
              <form action={createAction} className="flex flex-wrap items-center gap-2">
                <Input name="name" placeholder="Family name" className="h-9 max-w-48" />
                <Button type="submit" variant="outline" disabled={createPending}>
                  {createPending ? "Creating…" : "Create"}
                </Button>
              </form>
              {createState.error && (
                <p className="text-sm text-destructive">{createState.error}</p>
              )}
              {createState.ok && <p className="text-sm text-green-600">{createState.ok}</p>}
            </Section>

            <Section
              title="Your families"
              description={
                canDelete
                  ? "Switch between the families you belong to, or delete one you own."
                  : "You belong to one family."
              }
            >
              <ul className="space-y-2">
                {families.map((family) => (
                  <li key={family.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-bold">{family.name}</span>
                    {family.current && <Badge variant="secondary">Current</Badge>}
                    {family.owner && !family.current && <Badge variant="outline">Owner</Badge>}
                    {!family.current && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy === family.id}
                        onClick={() => go(family.id)}
                      >
                        {busy === family.id ? "Switching…" : "Switch"}
                      </Button>
                    )}
                    {family.owner && canDelete && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        disabled={busy === family.id}
                        onClick={() => {
                          setDeleteName("");
                          setPendingDelete(family);
                        }}
                      >
                        <Trash2 className="size-4" /> Delete
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {status && <p className="text-sm text-green-600">{status}</p>}
            </Section>
          </div>
        </div>
      </CardContent>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
            setDeleteName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name ?? "family"}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Every category, card, account, balance and entry in this family is deleted too. Your
              own account and the other families are not affected. This cannot be undone.
            </p>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                Type <span className="font-bold">{pendingDelete?.name}</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteName}
                onChange={(event) => setDeleteName(event.target.value)}
                placeholder={pendingDelete?.name}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteName.trim() !== (pendingDelete?.name ?? "")}
              onClick={confirmDelete}
            >
              Delete family
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
