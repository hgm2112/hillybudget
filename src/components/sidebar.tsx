"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ChevronLeft,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Receipt,
  Search,
  Settings,
  Sun,
  Tags,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "cn";
import { moneyWhole } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { BrandIcon, BrandLogo } from "@/components/brand";
import { useTheme } from "@/components/theme-provider";
import { signOut } from "@/app/login/actions";

export type SidebarAccount = { id: string; name: string; balance: number | null };
export type SidebarSection = { label: string; items: SidebarAccount[] };

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/categories", label: "Categories", icon: Tags },
];

export function Sidebar({
  householdName,
  role,
  sections,
}: {
  householdName: string;
  role: string;
  sections: SidebarSection[];
}) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  const nav = useMemo(() => NAV.filter((item) => item.label.toLowerCase().includes(q)), [q]);
  const filteredSections = useMemo(
    () =>
      sections
        .map((section) => ({ label: section.label, items: section.items.filter((item) => item.name.toLowerCase().includes(q)) }))
        .filter((section) => section.items.length > 0),
    [sections, q]
  );

  function body(isCollapsed: boolean, onNavigate?: () => void) {
    return (
      <>
        <div className={cn("relative flex items-center gap-2 px-2 py-3", isCollapsed && "flex-col")}>
          <Link
            href="/dashboard"
            onClick={onNavigate}
            className={cn("flex min-w-0 items-center", !isCollapsed && "w-full justify-center")}
            title="hillybudget"
          >
            {isCollapsed ? <BrandIcon className="size-6" /> : <BrandLogo className="h-auto w-full" />}
          </Link>
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-1 right-1 hidden md:inline-flex"
              aria-label="Collapse sidebar"
              onClick={() => setCollapsed(true)}
            >
              <ChevronLeft className="size-4" />
            </Button>
          )}
          {onNavigate && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-1 right-1"
              aria-label="Close menu"
              onClick={onNavigate}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>

        {isCollapsed && (
          <div className="flex justify-center px-2 pb-2">
            <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={() => setCollapsed(false)}>
              <ChevronLeft className="size-4 rotate-180" />
            </Button>
          </div>
        )}

        {!isCollapsed && (
          <div className="relative px-2 pb-2">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-full rounded-md border border-sidebar-border bg-background/60 pr-2 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
        )}

        <nav className="space-y-0.5 px-2">
          {nav.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={item.label}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  isCollapsed && "justify-center"
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {!isCollapsed && (
          <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-2">
          {filteredSections.map((section) => (
            <div key={section.label} className="rounded-xl border border-orange-500/40 bg-sidebar/40 p-2">
              {!isCollapsed && (
                <p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{section.label}</p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <div
                    key={item.id}
                    title={item.name}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                      isCollapsed && "justify-center"
                    )}
                  >
                    {!isCollapsed && <span className="min-w-0 flex-1 truncate">{item.name}</span>}
                    {!isCollapsed && (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.balance == null ? "—" : moneyWhole(item.balance)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        )}

        <div className="mt-auto border-t border-sidebar-border p-2 text-center">
          {!isCollapsed && (
            <p className="truncate px-2 pb-2 text-xs text-muted-foreground text-center">
              {householdName} · {role}
            </p>
          )}
          <div className={cn("flex items-center justify-center gap-1 divide-x divide-sidebar-border", isCollapsed && "flex-col")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              onClick={() => window.open("/settings", "_self")}
            >
              <Settings className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Stats"
              onClick={() => window.open("/stats", "_self")}
            >
              <BarChart3 className="size-4" />
            </Button>
            <form action={signOut} className={cn()}>
              <Button variant="ghost" size="icon-sm" type="submit" aria-label="Sign out">
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="sticky top-0 z-60 flex items-center justify-center border-b border-sidebar-border bg-sidebar px-3 py-3 text-sidebar-foreground md:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1 left-2"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-4" />
        </Button>
        <Link href="/dashboard" className="flex w-full justify-center">
          <BrandLogo className="h-auto w-full max-w-[14rem]" />
        </Link>
      </div>

      <aside
        className={cn(
          "sticky top-0 z-60 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] md:flex",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {body(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-70 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute top-0 left-0 flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            {body(false, () => setMobileOpen(false))}
          </aside>
        </div>
      )}
    </>
  );
}
