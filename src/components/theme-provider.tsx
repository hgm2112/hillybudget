"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(theme: Theme, hasWindow = true) {
  if (theme === "system") {
    if (!hasWindow || typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem("theme") as Theme | null) ?? "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme, typeof window !== "undefined"));
  const [userId, setUserId] = useState<string | null>(null);

  function applyTheme(nextTheme: Theme) {
    const root = document.documentElement;
    const isDark = resolveTheme(nextTheme, true) === "dark";
    root.classList.toggle("dark", isDark);
    setResolvedTheme(isDark ? "dark" : "light");
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: profile } = await supabase.from("profiles").select("theme").eq("user_id", data.user.id).maybeSingle();
      if (profile?.theme && ["light", "dark", "system"].includes(profile.theme)) {
        const incoming = profile.theme as Theme;
        setThemeState(incoming);
        localStorage.setItem("theme", incoming);
        applyTheme(incoming);
      } else {
        await supabase.from("profiles").upsert(
          { user_id: data.user.id, theme },
          { onConflict: "user_id", ignoreDuplicates: true }
        );
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const user = session?.user ?? null;
      setUserId(user?.id ?? null);
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("theme").eq("user_id", user.id).maybeSingle();
      if (profile?.theme && ["light", "dark", "system"].includes(profile.theme)) {
        const incoming = profile.theme as Theme;
        setThemeState(incoming);
        localStorage.setItem("theme", incoming);
        applyTheme(incoming);
      }
    });
    return () => subscription.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTheme(nextTheme: Theme) {
    setThemeState(nextTheme);
    if (typeof window !== "undefined") localStorage.setItem("theme", nextTheme);
    applyTheme(nextTheme);
    if (userId) {
      const supabase = createClient();
      supabase.from("profiles").upsert({ user_id: userId, theme: nextTheme }, { onConflict: "user_id" }).then(() => undefined);
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
