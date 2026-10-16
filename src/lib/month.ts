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
