export function toMonthKey(input: Date | string) {
  const date = typeof input === "string" ? new Date(input + "T00:00:00Z") : input;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export function shiftMonth(monthKey: string, delta: number) {
  const date = new Date(monthKey + "T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + delta);
  return toMonthKey(date);
}

export function monthLabel(monthKey: string) {
  return new Date(monthKey + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function monthName(monthKey: string) {
  return new Date(monthKey + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

export function monthRange(fromMonth: string, toMonth: string) {
  const from = toMonthKey(fromMonth);
  const to = toMonthKey(toMonth);
  if (from > to) return [to];
  const months: string[] = [];
  for (let current = from; current <= to; current = shiftMonth(current, 1)) {
    months.push(current);
  }
  return months;
}
