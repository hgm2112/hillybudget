import { describe, expect, it } from "vitest";
import { earliestMonth, latestMonth, windowMonths } from "@/lib/periods";

const months = [
  "2025-10-01",
  "2025-11-01",
  "2025-12-01",
  "2026-01-01",
  "2026-02-01",
  "2026-03-01",
  "2026-04-01",
  "2026-05-01",
  "2026-06-01",
  "2026-07-01",
  "2026-08-01",
  "2026-09-01",
  "2026-10-01",
];

describe("windowMonths", () => {
  it("returns the trailing months up to the anchor", () => {
    const window = windowMonths("3M", "2026-10-01", "2025-10-01");
    expect(window).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  it("returns the year to date for YTD", () => {
    const window = windowMonths("YTD", "2026-03-01", "2025-10-01");
    expect(window).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("spans the whole history for LIFETIME", () => {
    const window = windowMonths("LIFETIME", "2026-03-01", "2025-10-01");
    expect(window[0]).toBe("2025-10-01");
    expect(window.at(-1)).toBe("2026-03-01");
    expect(window).toHaveLength(6);
  });

  it("drops paused months inside the window", () => {
    const window = windowMonths("3M", "2026-10-01", "2025-10-01", new Set(["2026-09-01"]));
    expect(window).toEqual(["2026-08-01", "2026-10-01"]);
  });

  it("keeps every month when nothing is paused", () => {
    const window = windowMonths("12M", "2026-10-01", "2025-11-01", new Set());
    expect(window).toHaveLength(12);
    expect(window.at(-1)).toBe("2026-10-01");
  });
});

describe("latestMonth", () => {
  it("returns the most recent month", () => {
    expect(latestMonth(months, new Set(), "2026-10-01")).toBe("2026-10-01");
  });

  it("skips paused months", () => {
    expect(latestMonth(months, new Set(["2026-10-01"]), "2026-10-01")).toBe("2026-09-01");
  });

  it("falls back when every month is paused", () => {
    const paused = new Set(months);
    expect(latestMonth(months, paused, "2026-10-01")).toBe("2026-10-01");
  });
});

describe("earliestMonth", () => {
  it("returns the first month", () => {
    expect(earliestMonth(months, new Set())).toBe("2025-10-01");
  });

  it("skips paused months", () => {
    expect(earliestMonth(months, new Set(["2025-10-01"]))).toBe("2025-11-01");
  });
});
