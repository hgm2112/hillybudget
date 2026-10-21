// End-to-end tests for restore_into_new_household.
//
// RUN ONLY AGAINST A DISPOSABLE LOCAL SUPABASE STACK (never production):
//   supabase CLI + Docker, then:
//   npx supabase start && npx supabase db reset && npx supabase status
//   SUPABASE_LOCAL_URL=http://127.0.0.1:54321 \
//   SUPABASE_LOCAL_ANON_KEY=... \
//   node tests/restore-e2e.mjs
//
// Signs up throwaway users and exercises the RPC through the real HTTP
// layer (JWTs, PostgREST grants, RLS). Exits non-zero on the first failure.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_LOCAL_URL;
const ANON = process.env.SUPABASE_LOCAL_ANON_KEY;
if (!URL || !ANON) {
  console.error("Set SUPABASE_LOCAL_URL and SUPABASE_LOCAL_ANON_KEY (see header comment).");
  process.exit(1);
}

const DATA_TABLES = [
  "household_settings",
  "category_groups",
  "categories",
  "cards",
  "accounts",
  "recurring_items",
  "skipped_months",
  "account_archive_periods",
  "ledger_entries",
  "account_balances",
];

const NUMERIC_FIELDS = {
  household_settings: [],
  category_groups: [],
  categories: ["ideal_override"],
  cards: [],
  accounts: ["original_amount", "interest_rate", "monthly_payment"],
  recurring_items: ["amount"],
  skipped_months: [],
  account_archive_periods: [],
  ledger_entries: ["amount"],
  account_balances: ["balance", "contributions"],
};

const TIMESTAMPS = {
  household_settings: ["created_at", "updated_at"],
  category_groups: ["created_at", "updated_at"],
  categories: ["created_at", "updated_at"],
  cards: ["created_at", "updated_at"],
  accounts: ["created_at", "updated_at"],
  recurring_items: ["created_at", "updated_at"],
  skipped_months: ["created_at"],
  account_archive_periods: ["created_at"],
  ledger_entries: ["created_at", "updated_at"],
  account_balances: ["created_at", "updated_at"],
};

const uniqueSuffix = Date.now().toString(36);
const OWNER_EMAIL = `owner-${uniqueSuffix}@e2e.example`;
const MEMBER_EMAIL = `member-${uniqueSuffix}@e2e.example`;
const PASSWORD = "correct-horse-battery";

let cases = 0;
function assert(condition, message) {
  cases += 1;
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

function failCase(message, error) {
  console.error(`FAIL: ${message} — unexpected error:`, error?.message ?? error);
  process.exit(1);
}

function normalizeTimestamps(table, row) {
  const out = { ...row };
  for (const field of TIMESTAMPS[table] ?? []) {
    if (out[field] != null) out[field] = new Date(out[field]).getTime();
  }
  return out;
}

function expectedRow(table, fixtureRow, newHouseholdId, categoryKindById, existingUserIds) {
  const row = { ...fixtureRow };
  delete row.import_batch_id;
  row.household_id = newHouseholdId;
  if (row.created_by && !existingUserIds.has(row.created_by)) row.created_by = null;
  if (table === "ledger_entries" && row.kind) row.kind = categoryKindById.get(row.category_id);
  for (const field of NUMERIC_FIELDS[table] ?? []) {
    if (row[field] != null) row[field] = Number(row[field]);
  }
  return normalizeTimestamps(table, row);
}

function actualRow(table, row) {
  const out = { ...row };
  delete out.import_batch_id;
  for (const field of NUMERIC_FIELDS[table] ?? []) {
    if (out[field] != null) out[field] = Number(out[field]);
  }
  return normalizeTimestamps(table, out);
}

async function expectRestoreError(ownerClient, payload, message, expectedPattern) {
  const { error } = await ownerClient.rpc("restore_into_new_household", { p_payload: payload });
  cases += 1;
  if (!error) {
    console.error(`FAIL: ${message} — restore unexpectedly succeeded`);
    process.exit(1);
  }
  if (expectedPattern && !expectedPattern.test(error.message ?? "")) {
    console.error(`FAIL: ${message} — wrong rejection message: ${error.message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message} (rpc rejected: ${error.message})`);
}

async function householdCount(client) {
  const { count, error } = await client.from("households").select("*", { count: "exact", head: true });
  if (error) failCase("counting households", error);
  return count;
}

async function fetchAll(client, table, householdId) {
  const { data, error } = await client.from(table).select("*").eq("household_id", householdId);
  if (error) failCase(`fetching ${table}`, error);
  return data ?? [];
}

function verifyRestoredData(ownerClient, fixture, newHouseholdId, existingUserIds) {
  const categoryKindById = new Map(fixture.tables.categories.map((row) => [row.id, row.kind]));
  return Promise.all(
    DATA_TABLES.map(async (table) => {
      const rows = await fetchAll(ownerClient, table, newHouseholdId);
      const expectedById = new Map(
        fixture.tables[table].map((fixtureRow) => [
          fixtureRow.id,
          expectedRow(table, fixtureRow, newHouseholdId, categoryKindById, existingUserIds),
        ])
      );
      assert(rows.length === fixture.tables[table].length, `${table}: row count preserved (${rows.length})`);
      for (const dbRow of rows) {
        const expected = expectedById.get(dbRow.id);
        assert(expected !== undefined, `${table}: row id ${dbRow.id} was imported with its original id`);
        assert(
          JSON.stringify(expected) === JSON.stringify(actualRow(table, dbRow)),
          `${table}: row ${dbRow.id} matches the backup field-for-field`
        );
      }
    })
  );
}

const fixtureBase = JSON.parse(readFileSync("tests/fixtures/restore-fixture.json", "utf8"));

const owner = createClient(URL, ANON, { auth: { persistSession: false } });
const member = createClient(URL, ANON, { auth: { persistSession: false } });
const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });

const signUps = await Promise.all([
  owner.auth.signUp({ email: OWNER_EMAIL, password: PASSWORD }),
  member.auth.signUp({ email: MEMBER_EMAIL, password: PASSWORD }),
]);
for (const [index, signedUp] of signUps.entries()) {
  if (signedUp.error) failCase(index === 0 ? "owner signup" : "member signup", signedUp.error);
  if (!signedUp.data.user) failCase(index === 0 ? "owner signup" : "member signup", "no user returned");
}
const ownerUser = signUps[0].data.user;
const memberUser = signUps[1].data.user;
const existingUserIds = new Set([ownerUser.id, memberUser.id]);

const fixture = JSON.parse(JSON.stringify(fixtureBase));
fixture.household.owner_id = ownerUser.id;
fixture.tables.households[0].owner_id = ownerUser.id;
fixture.tables.ledger_entries = fixture.tables.ledger_entries.map((row) => {
  if (row.created_by === "11111111-1111-1111-1111-111111111111") row.created_by = ownerUser.id;
  return row;
});

const { data: currentHouseholdId, error: createError } = await owner.rpc("create_household", {
  household_name: "Current Home",
});
if (createError) failCase("create_household", createError);

const { count: baselineCategories } = await owner
  .from("categories")
  .select("id", { count: "exact", head: true })
  .eq("household_id", currentHouseholdId);
const baselineHouseholds = await householdCount(owner);
const { count: baselineLedger } = await owner
  .from("ledger_entries")
  .select("id", { count: "exact", head: true })
  .eq("household_id", currentHouseholdId);

// CASE 1: happy path — full restore, preservation, and no drift in the current household
{
  const { data, error } = await owner.rpc("restore_into_new_household", {
    p_payload: JSON.parse(JSON.stringify(fixture)),
  });
  if (error) failCase("happy-path restore", error);
  const newHouseholdId = data.household_id;

  assert(newHouseholdId !== currentHouseholdId, "restore creates a new household id");
  assert(data.household_name === "Hilly Test Home", "restored household name");
  assert(
    typeof data.invite_code === "string" && /^[A-Z0-9]{8}$/.test(data.invite_code),
    `fresh invite code format (${data.invite_code})`
  );
  for (const table of DATA_TABLES) {
    assert(
      data.counts[table] === fixture.tables[table].length,
      `counts.${table} = ${fixture.tables[table].length}`
    );
  }
  await verifyRestoredData(owner, fixture, newHouseholdId, existingUserIds);

  const { data: newMembers } = await owner
    .from("household_members")
    .select("user_id, role")
    .eq("household_id", newHouseholdId);
  assert(
    newMembers.length === 1 && newMembers[0].user_id === ownerUser.id && newMembers[0].role === "owner",
    "exactly one owner membership in the restored household"
  );

  const { data: corrected } = await owner
    .from("ledger_entries")
    .select("kind, created_by, import_batch_id")
    .eq("id", "llllllll-0000-0000-0000-000000000002")
    .single();
  assert(corrected.kind === "income", "entry kind corrected to match its income category");
  assert(corrected.created_by === null, "created_by for an unknown auth user is nulled");
  assert(corrected.import_batch_id === null, "import_batch_id removed");

  const { data: preserved } = await owner
    .from("ledger_entries")
    .select("created_by")
    .eq("id", "llllllll-0000-0000-0000-000000000001")
    .single();
  assert(preserved.created_by === ownerUser.id, "created_by preserved for a real auth user");

  assert(householdCount(owner) === baselineHouseholds + 1, "exactly one household added");

  const { count: currentLedgerAfter } = await owner
    .from("ledger_entries")
    .select("id", { count: "exact", head: true })
    .eq("household_id", currentHouseholdId);
  assert(currentLedgerAfter === baselineLedger, "current household ledger untouched");

  const { count: currentCategoriesAfter } = await owner
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("household_id", currentHouseholdId);
  assert(currentCategoriesAfter === baselineCategories, "current household categories untouched");

  // CASE 2: a member of the old household cannot see or write the restored household.
  const inviteCode = (
    await owner.from("households").select("invite_code").eq("id", currentHouseholdId).single()
  ).data.invite_code;
  const { error: joinError } = await member.rpc("join_household", { invite: inviteCode });
  if (joinError) failCase("member joining current household", joinError);

  const { data: hiddenHousehold } = await member
    .from("households")
    .select("id")
    .eq("id", newHouseholdId);
  assert((hiddenHousehold ?? []).length === 0, "restored household is hidden from the other member");

  const { data: hiddenEntries } = await member
    .from("ledger_entries")
    .select("id")
    .eq("household_id", newHouseholdId);
  assert((hiddenEntries ?? []).length === 0, "restored ledger entries hidden from the other member");

  const { error: insertError } = await member.from("ledger_entries").insert({
    household_id: newHouseholdId,
    month: "2026-01-01",
    category_id: "eeeeeeee-0000-0000-0000-000000000001",
    kind: "expense",
    amount: 1,
  });
  assert(!!insertError, "other member cannot write into the restored household");
}

// CASE 3: non-owner is rejected.
await expectRestoreError(
  member,
  JSON.parse(JSON.stringify(fixture)),
  "non-owner member cannot restore",
  /Only household owners/
);

// CASE 4: unauthenticated caller is rejected (execution revoked from anon).
await expectRestoreError(
  anonClient,
  JSON.parse(JSON.stringify(fixture)),
  "unauthenticated caller cannot restore"
);

// CASES 5..13: invalid payloads are rejected atomically — no household is created.
const householdsBeforeFailures = await householdCount(owner);
const failureCases = [
  ["unsupported schema version", (payload) => ({ ...payload, schema_version: 2 })],
  ["unsupported app marker", (payload) => ({ ...payload, app: "someone-else" })],
  [
    "missing required fields",
    (payload) => {
      const clone = JSON.parse(JSON.stringify(payload));
      delete clone.tables.categories[0].name;
      return clone;
    },
  ],
  [
    "missing tables section",
    (payload) => {
      const clone = JSON.parse(JSON.stringify(payload));
      delete clone.tables.cards;
      return clone;
    },
  ],
  [
    "duplicate row id",
    (payload) => {
      const clone = JSON.parse(JSON.stringify(payload));
      clone.tables.ledger_entries[1].id = clone.tables.ledger_entries[0].id;
      return clone;
    },
  ],
  [
    "broken foreign key",
    (payload) => {
      const clone = JSON.parse(JSON.stringify(payload));
      clone.tables.ledger_entries[0].category_id = "00000000-0000-0000-0000-999999999999";
      return clone;
    },
  ],
  [
    "duplicate category names",
    (payload) => {
      const clone = JSON.parse(JSON.stringify(payload));
      clone.tables.categories[2].name = clone.tables.categories[0].name;
      return clone;
    },
  ],
  [
    "invalid month",
    (payload) => {
      const clone = JSON.parse(JSON.stringify(payload));
      clone.tables.ledger_entries[0].month = "2025-03-08";
      return clone;
    },
  ],
  [
    "amount overflow",
    (payload) => {
      const clone = JSON.parse(JSON.stringify(payload));
      clone.tables.ledger_entries[0].amount = 1200000000000;
      return clone;
    },
  ],
];
for (const [label, mutate] of failureCases) {
  await expectRestoreError(owner, mutate(JSON.parse(JSON.stringify(fixture))), `rejects ${label}`);
}
assert(
  householdCount(owner) === householdsBeforeFailures,
  "failed restores left no household records behind"
);

// CASE 14: duplicate submissions create distinct households (documented behavior).
{
  const first = await owner.rpc("restore_into_new_household", {
    p_payload: JSON.parse(JSON.stringify(fixture)),
  });
  if (first.error) failCase("retry restore (first)", first.error);
  const second = await owner.rpc("restore_into_new_household", {
    p_payload: JSON.parse(JSON.stringify(fixture)),
  });
  if (second.error) failCase("retry restore (second)", second.error);
  assert(first.data.household_id !== second.data.household_id, "repeated confirmed submissions create distinct households");
  assert(householdCount(owner) === householdsBeforeFailures + 2, "retry households counted");
}

console.log(`\nrestore e2e complete — ${cases} assertions passed`);
