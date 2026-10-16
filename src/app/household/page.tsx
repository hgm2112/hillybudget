"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function HouseholdPage() {
  const router = useRouter();
  const supabase = createClient();
  const [checking, setChecking] = useState(true);
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
      await supabase.from("profiles").upsert(
        { user_id: data.user.id, display_name: data.user.email?.split("@")[0] ?? null, theme: "system" },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
      const { data: membership } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", data.user.id)
        .limit(1)
        .maybeSingle();
      if (membership) router.replace("/");
      setChecking(false);
    });
  }, [router, supabase]);

  async function createHousehold(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setLoading(true);
    try {
      const { data: householdId, error } = await supabase.rpc("create_household", {
        household_name: householdName,
      });
      if (error) {
        console.error("create_household RPC error", error);
        throw new Error(formatSupabaseError(error, "Failed to create household"));
      }
      if (!householdId) {
        const fallback = "Failed to create household: no id returned";
        console.error(fallback);
        throw new Error(fallback);
      }
      const { error: categoryError } = await supabase.from("categories").upsert(
        DEFAULT_CATEGORIES.map((category, index) => ({
          household_id: householdId,
          name: category.name,
          color: category.color,
          type: category.type,
          sort_order: index,
        })),
        { onConflict: "household_id,name", ignoreDuplicates: true }
      );
      if (categoryError) {
        console.error("category seed error", categoryError);
        throw new Error(formatSupabaseError(categoryError, "Failed to seed categories"));
      }
      router.replace("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create household";
      console.error("createHousehold caught:", err);
      setCreateError(message);
    } finally {
      setLoading(false);
    }
  }

  async function joinHousehold(e: React.FormEvent) {
    e.preventDefault();
    setJoinError(null);
    setLoading(true);
    try {
      const { error } = await supabase.rpc("join_household", { invite: inviteCode });
      if (error) {
        console.error("join_household RPC error", error);
        throw new Error(formatSupabaseError(error, "Failed to join household"));
      }
      router.replace("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join household";
      console.error("joinHousehold caught:", err);
      setJoinError(message);
    } finally {
      setLoading(false);
    }
  }

  function formatSupabaseError(error: unknown, fallback: string) {
    const err = (error ?? {}) as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [err.message, err.code && `code=${err.code}`, err.details, err.hint].filter(Boolean);
    return parts.length ? parts.join(" | ") : fallback;
  }

  if (checking) return <main className="p-8">Loading...</main>;

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create household</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createHousehold} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Household name</Label>
                <Input id="name" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} required />
              </div>
              {createError && <p className="text-sm text-red-600">{createError}</p>}
              <Button type="submit" disabled={loading}>Create</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Join household</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={joinHousehold} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Invite code</Label>
                <Input id="code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
              </div>
              {joinError && <p className="text-sm text-red-600">{joinError}</p>}
              <Button type="submit" disabled={loading}>Join</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
