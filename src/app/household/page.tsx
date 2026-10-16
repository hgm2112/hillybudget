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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
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
    setError(null);
    setLoading(true);
    try {
      const { data: householdId, error } = await supabase.rpc("create_household", {
        household_name: householdName,
      });
      if (error || !householdId) throw error ?? new Error("Failed to create household");
      await supabase.from("categories").insert(
        DEFAULT_CATEGORIES.map((category, index) => ({
          household_id: householdId,
          name: category.name,
          color: category.color,
          type: category.type,
          sort_order: index,
        }))
      );
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create household");
    } finally {
      setLoading(false);
    }
  }

  async function joinHousehold(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.rpc("join_household", { invite: inviteCode });
      if (error) throw error;
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join household");
    } finally {
      setLoading(false);
    }
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
              {error && <p className="text-sm text-red-600">{error}</p>}
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
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={loading}>Join</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
