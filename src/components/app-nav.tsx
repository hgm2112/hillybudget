"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

const LINKS = [
  { href: "/", label: "Expenses" },
  { href: "/accounts", label: "Accounts" },
  { href: "/recurring", label: "Recurring" },
  { href: "/categories", label: "Categories" },
  { href: "/stats", label: "Stats" },
];

export function AppNav() {
  const supabase = createClient();
  const [signedIn, setSignedIn] = useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });
    return () => subscription.subscription.unsubscribe();
  }, [supabase]);

  if (!signedIn) return null;

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
          <Button size="sm" variant="outline" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light" : "Dark"}
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
