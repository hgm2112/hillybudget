import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseRestoreJson,
  RESTORE_RPC_SECTIONS,
  restoredHouseholdName,
  validateBackupPayload,
} from "@/lib/restore";

let counter = 0;
function uuid(): string {
  const n = (++counter).toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-0000-0000-${n}`;
}

const HOUSEHOLD_ID = uuid();

function baseRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuid(),
    household_id: HOUSEHOLD_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function makeBackup(overrides: {
  ledger?: Record<string, unknown>[];
  categories?: Record<string, unknown>[];
  recurring?: Record<string, unknown>[];
} = {}): Record<string, unknown> {
  const categories = overrides.categories ?? [
    baseRow({ name: "Groceries", kind: "expense", color: "#22c55e", sort_order: 0 }),
  ];
  const categoryId = categories[0].id as string;
  const recurring = overrides.recurring ?? [
    baseRow({ category_id: categoryId, card_id: null, amount: 100, start_month: "2026-01-01", end_month: null, active: true }),
  ];
  const ledger = overrides.ledger ?? [
    baseRow({ month: "2026-01-01", category_id: categoryId, card_id: null, kind: "expense", amount: 25.5, note: null, recurring_item_id: null, created_by: null }),
  ];

  return {
    app: "hillybudget",
    schema_version: 1,
    exported_at: "2026-10-21T05:48:07.761Z",
    household: { id: HOUSEHOLD_ID, name: "Test Household", owner_id: uuid() },
    tables: {
      households: [baseRow({ id: HOUSEHOLD_ID, name: "Test Household", owner_id: uuid() })],
      household_members: [baseRow({ role: "owner", user_id: uuid() })],
      household_settings: [baseRow({ ideal_window: "trailing12" })],
      category_groups: [],
      categories,
      cards: [],
      accounts: [],
      recurring_items: recurring,
      skipped_months: [],
      account_archive_periods: [],
      ledger_entries: ledger,
      account_balances: [],
    },
  };
}

describe("restore validator", () => {
  it("accepts a well-formed backup and reports counts", () => {
    const result = validateBackupPayload(makeBackup());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts.categories).toBe(1);
    expect(result.counts.ledger_entries).toBe(1);
    expect(result.counts.household_settings).toBe(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.payload.household.name).toBe("Test Household");
  });

  it("strips import_batch_id from restore rows", () => {
    const categoryId = uuid();
    const result = validateBackupPayload(makeBackup({
      categories: [baseRow({ id: categoryId, name: "Groceries", kind: "expense" })],
      ledger: [baseRow({ month: "2026-02-01", category_id: categoryId, kind: "expense", amount: 1, import_batch_id: uuid() })],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.tables.ledger_entries[0]).not.toHaveProperty("import_batch_id");
  });

  it("rejects invalid JSON with a plain-language message", () => {
    const result = parseRestoreJson("{ not json ]");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/valid JSON/i);
  });

  it("rejects an unsupported schema version", () => {
    const backup = makeBackup();
    backup.schema_version = 99;
    const result = validateBackupPayload(backup);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/schema version/i);
  });

  it("rejects a file missing the tables block", () => {
    const backup = makeBackup();
    delete backup.tables;
    const result = validateBackupPayload(backup);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/tables block/i);
  });

  it("rejects duplicate row ids within a table", () => {
    const categoryId = uuid();
    const duplicated = [
      baseRow({ id: categoryId, name: "Groceries", kind: "expense" }),
      baseRow({ id: categoryId, name: "Groceries", kind: "expense" }),
    ];
    const result = validateBackupPayload(makeBackup({ categories: duplicated, ledger: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/more than once/i);
  });

  it("rejects ledger entries referencing a missing category", () => {
    const backup = makeBackup({
      ledger: [baseRow({ month: "2026-01-01", category_id: uuid(), kind: "expense", amount: 10 })],
    });
    const result = validateBackupPayload(backup);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/isn't in the backup/i);
  });

  it("rejects rows belonging to a different household", () => {
    const otherId = uuid();
    const result = validateBackupPayload(makeBackup({
      ledger: [baseRow({ household_id: otherId, month: "2026-01-01", category_id: uuid(), kind: "expense", amount: 10 })],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/different household/i);
  });

  it("rejects rows missing required fields", () => {
    const result = validateBackupPayload(makeBackup({
      categories: [baseRow({ kind: "expense" })],
      ledger: [],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/required field "name"/i);
  });

  it("rejects invalid month formats", () => {
    const backup = makeBackup();
    (backup.tables as Record<string, unknown[]>).ledger_entries = [
      baseRow({ month: "2026-01-15", category_id: uuid(), kind: "expense", amount: 10 }),
    ];
    const result = validateBackupPayload(backup);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/expected YYYY-MM-01/i);
  });

  it("rejects negative recurring amounts", () => {
    const result = validateBackupPayload(makeBackup({
      recurring: [baseRow({ category_id: uuid(), amount: -5, start_month: "2026-01-01" })],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/below 0/i);
  });

  it("warns (not fails) when an entry's kind differs from its category", () => {
    const backup = makeBackup();
    const payload = backup.tables as Record<string, Record<string, unknown>[]>;
    payload.categories.push(baseRow({ name: "Ebay Earnings", kind: "income" }));
    payload.ledger_entries = [
      baseRow({ month: "2026-01-01", category_id: payload.categories[1].id, kind: "expense", amount: 12 }),
    ];
    const result = validateBackupPayload(backup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toContain("will be corrected on restore");
  });

  it("accepts the shared e2e fixture and reports its counts and warnings", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/restore-fixture.json", "utf8"));
    const result = validateBackupPayload(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts.categories).toBe(3);
    expect(result.counts.ledger_entries).toBe(3);
    expect(result.counts.account_balances).toBe(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("will be corrected on restore");
  });

  it("accepts backup rows without ids for household_members and household_settings", () => {
    const backup = makeBackup();
    const tables = backup.tables as Record<string, Record<string, unknown>[]>;
    for (const row of tables.household_members) delete row.id;
    for (const row of tables.household_settings) delete row.id;
    const result = validateBackupPayload(backup);
    expect(result.ok).toBe(true);
  });

  it("still rejects a data row without an id", () => {
    const backup = makeBackup();
    const tables = backup.tables as Record<string, Record<string, unknown>[]>;
    delete tables.categories[0].id;
    const result = validateBackupPayload(backup);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/categories: a row has a missing or invalid id/i);
  });

  it("names the restored household with a restore suffix", () => {
    expect(restoredHouseholdName("WHill", "2026-10-21T08:23:05.990Z")).toBe("WHill (restored 2026-10-21)");
    expect(restoredHouseholdName("WHill (restored 2026-10-21)", "2026-10-21T08:23:05.990Z")).toBe(
      "WHill (restored 2026-10-21)"
    );
    expect(restoredHouseholdName("WHill", "2026-01-02T00:00:00.000Z")).toBe("WHill (restored 2026-01-02)");
  });

  it("builds the RPC payload with the format markers and every required section", () => {
    const backup = makeBackup();
    const tables = backup.tables as Record<string, Record<string, unknown>[]>;
    for (const row of tables.household_members) delete row.id;
    for (const row of tables.household_settings) delete row.id;
    const result = validateBackupPayload(backup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload;
    expect(payload.app).toBe("hillybudget");
    expect(payload.schema_version).toBe(1);
    expect(payload.household.id).toBe(HOUSEHOLD_ID);
    expect(typeof payload.exported_at).toBe("string");
    expect(Object.keys(payload.tables).sort()).toEqual([...RESTORE_RPC_SECTIONS].sort());
    expect(payload.tables.household_members[0]).not.toHaveProperty("id");
    expect(payload.tables.household_settings[0]).not.toHaveProperty("id");
    expect(payload.tables.categories[0].id).toBe(tables.categories[0].id);
  });
});
