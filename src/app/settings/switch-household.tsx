"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { switchHousehold } from "./actions";

type HouseholdOption = { id: string; name: string };

export function SwitchHousehold({
  households,
  currentId,
}: {
  households: HouseholdOption[];
  currentId: string;
}) {
  const [selected, setSelected] = useState(currentId);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function go() {
    if (selected === currentId) return;
    setBusy(true);
    const ok = await switchHousehold(selected);
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-lg font-semibold">Switch household</h2>
        <p className="text-sm text-muted-foreground">
          All these households belong to you. Switching changes which household the app shows — no
          data moves.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={busy}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {households.map((household) => (
              <option key={household.id} value={household.id}>
                {household.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" disabled={busy || selected === currentId} onClick={go}>
            {busy ? "Switching…" : "Switch"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
