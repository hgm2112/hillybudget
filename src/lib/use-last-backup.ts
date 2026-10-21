"use client";

import { useSyncExternalStore } from "react";
import { lastBackupKey } from "@/lib/backup";

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export function writeLastBackup(householdId: string, iso: string) {
  window.localStorage.setItem(lastBackupKey(householdId), iso);
  listeners.forEach((listener) => listener());
}

export function useLastBackup(householdId: string): string | null {
  const key = lastBackupKey(householdId);
  return useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key),
    () => null
  );
}
