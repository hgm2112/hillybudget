export type AccountKind = "liquid" | "retirement" | "loan";

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  color: string;
  sort_order: number;
  original_amount: number | null;
};

export type Balance = { id: string; account_id: string; month: string; balance: number };

export const GROUP_ORDER: AccountKind[] = ["liquid", "retirement", "loan"];

export function parseBalanceInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  let total = 0;
  for (const part of cleaned.split("+")) {
    if (part === "") continue;
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

export function formatBalance(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export type DeltaInfo = {
  delta: number;
  percent: number | null;
  direction: "up" | "down" | "flat";
  good: boolean | null;
};

export function deltaInfo(current: number, previous: number | null, kind: AccountKind): DeltaInfo | null {
  if (previous === null) return null;
  const delta = current - previous;
  const direction: DeltaInfo["direction"] = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const good = delta === 0 ? null : kind === "loan" ? delta < 0 : delta > 0;
  const percent = previous !== 0 ? Math.abs((delta / previous) * 100) : null;
  return { delta, percent, direction, good };
}

export function sharePercent(value: number, total: number): number | null {
  if (total <= 0) return null;
  return (value / total) * 100;
}

export function payoffInfo(current: number, original: number | null): { percent: number; paid: number } | null {
  if (original === null || original <= 0) return null;
  const paid = Math.min(Math.max(original - current, 0), original);
  return { percent: (paid / original) * 100, paid };
}

export function previousRecordedMonth(balances: Balance[], month: string): string | null {
  let best: string | null = null;
  for (const balance of balances) {
    if (balance.month < month && (best === null || balance.month > best)) best = balance.month;
  }
  return best;
}

export function latestBalanceBefore(balances: Balance[], accountId: string, month: string): number | null {
  let best: Balance | null = null;
  for (const balance of balances) {
    if (balance.account_id !== accountId || balance.month >= month) continue;
    if (best === null || balance.month > best.month) best = balance;
  }
  return best ? best.balance : null;
}

export function carryForwardItems(
  accounts: Account[],
  balances: Balance[],
  month: string
): { accountId: string; balance: number }[] {
  const hasCurrent = new Set(balances.filter((balance) => balance.month === month).map((balance) => balance.account_id));
  const items: { accountId: string; balance: number }[] = [];
  for (const account of accounts) {
    if (hasCurrent.has(account.id)) continue;
    const previous = latestBalanceBefore(balances, account.id, month);
    if (previous !== null) items.push({ accountId: account.id, balance: previous });
  }
  return items;
}
