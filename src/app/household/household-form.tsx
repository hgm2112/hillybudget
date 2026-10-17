"use client";

import { useActionState } from "react";
import { createHousehold, joinHousehold, type HouseholdState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: HouseholdState = {};

export function HouseholdForm() {
  const [createState, createAction, createPending] = useActionState(createHousehold, initialState);
  const [joinState, joinAction, joinPending] = useActionState(joinHousehold, initialState);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Create household</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Household name</Label>
              <Input id="name" name="name" required />
            </div>
            {createState.error && <p className="text-sm text-red-600">{createState.error}</p>}
            <Button type="submit" disabled={createPending}>
              {createPending ? "Creating..." : "Create"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Join household</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={joinAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Invite code</Label>
              <Input id="code" name="code" required />
            </div>
            {joinState.error && <p className="text-sm text-red-600">{joinState.error}</p>}
            <Button type="submit" disabled={joinPending}>
              {joinPending ? "Joining..." : "Join"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
