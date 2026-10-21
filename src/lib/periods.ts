import { monthRange, shiftMonth } from "./month";

export const PERIODS = [
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "12M", months: 12 },
  { key: "YTD", months: 0 },
  { key: "LIFETIME", months: 0 },
] as const;

export type Period = (typeof PERIODS)[number]["key"];

function rawWindow(period: Period, anchor: string, floor: string) {
  if (period === "YTD") {
    const months: string[] = [];
    let cursor = `${anchor.slice(0, 4)}-01-01`;
    while (cursor <= anchor) {
      months.push(cursor);
      cursor = shiftMonth(cursor, 1);
    }
    return months;
  }
  if (period === "LIFETIME") {
    return floor && floor < anchor ? monthRange(floor, anchor) : [anchor];
  }
  const count = PERIODS.find((entry) => entry.key === period)?.months ?? 12;
  return Array.from({ length: count }, (_, index) => shiftMonth(anchor, index - (count - 1)));
}

export function windowMonths(
  period: Period,
  anchor: string,
  floor: string,
  paused: Set<string> = new Set()
) {
  return rawWindow(period, anchor, floor).filter((month) => !paused.has(month));
}

export function latestMonth(months: Iterable<string>, paused: Set<string>, fallback: string) {
  let latest = "";
  for (const month of months) {
    if (paused.has(month)) continue;
    if (month > latest) latest = month;
  }
  return latest || fallback;
}

export function earliestMonth(months: Iterable<string>, paused: Set<string>) {
  let earliest = "";
  for (const month of months) {
    if (paused.has(month)) continue;
    if (!earliest || month < earliest) earliest = month;
  }
  return earliest;
}
