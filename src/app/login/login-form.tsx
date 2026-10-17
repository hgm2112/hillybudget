"use client";

import { useActionState, useState } from "react";
import { authenticate, type AuthState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: AuthState = {};

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, formAction, pending] = useActionState(authenticate, initialState);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{mode === "signin" ? "Sign in" : "Create account"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="mode" value={mode} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
            />
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.message && <p className="text-sm text-green-600">{state.message}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Working..." : mode === "signin" ? "Sign in" : "Sign up"}
          </Button>
          <button
            type="button"
            className="w-full text-sm text-muted-foreground underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
