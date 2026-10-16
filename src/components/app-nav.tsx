"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveHousehold } from "@/lib/household";
import { Button, buttonVariants } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const LINKS = [
  { href: "/", label: "Expenses" },
  { href: "/accounts", label: "Accounts" },
  { href: "/recurring", label: "Recurring" },
  { href: "/categories", label: "Categories" },
  { href: "/stats", label: "Stats" },
  { href: "/settings", label: "Settings" },
];

export function AppNav() {
  const supabase = createClient();
  const [hasHousehold, setHasHousehold] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();

  async function checkMembership() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setHasHousehold(false);
      return;
    }
    const membership = await resolveHousehold(supabase, userData.user.id);
    setHasHousehold(Boolean(membership));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkMembership();
    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      checkMembership();
    });
    return () => subscription.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  if (!hasHousehold) return null;

  return (
    <nav className="border-b bg-background/95">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 p-2">
        <div className="flex flex-wrap gap-2">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await supabase.auth.signOut();
              router.push("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </nav>
  );
}
