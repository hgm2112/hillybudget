import {
  BACKUP_APP,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  type BackupTable,
} from "@/lib/backup";

export const RESTORE_MAX_BYTES = 25 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}-01$/;
const KINDS = new Set(["expense", "income"]);
const ACCOUNT_KINDS = new Set(["liquid", "retirement", "loan"]);
const IDEAL_WINDOWS = new Set(["all", "trailing12", "trailing6"]);

export const RESTORE_DATA_TABLES = BACKUP_TABLES.filter(
  (table) => table !== "households" && table !== "household_members"
) as RestoreDataTable[];

export type RestoreDataTable = Exclude<BackupTable, "households" | "household_members">;

export type ValidatedRestorePayload = {
  household: { id: string; name: string; owner_id: string };
  exported_at: string;
  tables: Record<RestoreDataTable, RestoreRow[]>;
};

export type RestoreRow = Record<string, unknown> & { id: string };

export type RestoreValidation =
  | { ok: true; payload: ValidatedRestorePayload; counts: Record<RestoreDataTable, number>; warnings: string[] }
  | { ok: false; errors: string[] };

type FieldSpec =
  | { type: "string"; required: boolean }
  | { type: "uuid"; required: boolean }
  | { type: "enum"; values: Set<string>; required: boolean }
  | { type: "bool"; required: false }
  | { type: "number"; min?: number; required: boolean };

const SPECS: Record<RestoreDataTable, Record<string, FieldSpec>> = {
  household_settings: {
    ideal_window: { type: "enum", values: IDEAL_WINDOWS, required: true },
  },
  category_groups: {
    name: { type: "string", required: true },
    color: { type: "string", required: false },
    sort_order: { type: "number", required: false },
  },
  categories: {
    name: { type: "string", required: true },
    kind: { type: "enum", values: KINDS, required: true },
    color: { type: "string", required: false },
    sort_order: { type: "number", required: false },
    archived: { type: "bool", required: false },
    ideal_override: { type: "number", required: false },
    excluded: { type: "bool", required: false },
    icon: { type: "string", required: false },
    no_ideal: { type: "bool", required: false },
    group_id: { type: "uuid", required: false },
  },
  cards: {
    name: { type: "string", required: true },
    color: { type: "string", required: false },
    sort_order: { type: "number", required: false },
    archived: { type: "bool", required: false },
  },
  accounts: {
    name: { type: "string", required: true },
    kind: { type: "enum", values: ACCOUNT_KINDS, required: true },
    color: { type: "string", required: false },
    sort_order: { type: "number", required: false },
    archived: { type: "bool", required: false },
    original_amount: { type: "number", required: false },
    interest_rate: { type: "number", required: false },
    monthly_payment: { type: "number", required: false },
    start_date: { type: "string", required: false },
  },
  recurring_items: {
    category_id: { type: "uuid", required: true },
    card_id: { type: "uuid", required: false },
    amount: { type: "number", min: 0, required: true },
    note: { type: "string", required: false },
    start_month: { type: "string", required: true },
    end_month: { type: "string", required: false },
    active: { type: "bool", required: false },
  },
  skipped_months: {
    month: { type: "string", required: true },
  },
  account_archive_periods: {
    account_id: { type: "uuid", required: true },
    start_month: { type: "string", required: true },
    end_month: { type: "string", required: false },
  },
  ledger_entries: {
    month: { type: "string", required: true },
    category_id: { type: "uuid", required: true },
    card_id: { type: "uuid", required: false },
    kind: { type: "enum", values: KINDS, required: true },
    amount: { type: "number", min: 0, required: true },
    note: { type: "string", required: false },
    recurring_item_id: { type: "uuid", required: false },
    created_by: { type: "uuid", required: false },
  },
  account_balances: {
    account_id: { type: "uuid", required: true },
    month: { type: "string", required: true },
    balance: { type: "number", required: true },
    contributions: { type: "number", required: false },
  },
};

const DATE_TABLE_FIELDS: Partial<Record<RestoreDataTable, string[]>> = {
  accounts: ["start_date"],
  recurring_items: ["start_month", "end_month"],
  account_archive_periods: ["start_month", "end_month"],
};

const MONTH_FIELDS: Partial<Record<RestoreDataTable, string[]>> = {
  recurring_items: ["start_month", "end_month"],
  skipped_months: ["month"],
  account_archive_periods: ["start_month", "end_month"],
  ledger_entries: ["month"],
  account_balances: ["month"],
};

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseRestoreJson(text: string): RestoreValidation {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The file isn't valid JSON."] };
  }
  return validateBackupPayload(data);
}

export function validateBackupPayload(data: unknown): RestoreValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, errors: ["The file doesn't look like a Hillybudget backup (expected a JSON object)."] };
  }
  const root = data as Record<string, unknown>;

  if (root.app !== BACKUP_APP) {
    errors.push(
      root.app === undefined
        ? "The file is missing the app marker (not a Hillybudget backup)."
        : `Unsupported app "${String(root.app)}" — expected "hillybudget".`
    );
  }
  if (root.schema_version !== BACKUP_SCHEMA_VERSION) {
    errors.push(
      root.schema_version === undefined
        ? "The file has no schema version."
        : `Unsupported schema version ${String(root.schema_version)} — this restore supports version ${BACKUP_SCHEMA_VERSION}.`
    );
  }
  if (typeof root.exported_at !== "string" || Number.isNaN(new Date(root.exported_at).getTime())) {
    errors.push("The file has no readable export date.");
  }

  const household = root.household;
  if (typeof household !== "object" || household === null) {
    errors.push("The file has no household block.");
    return { ok: false, errors: finishErrors(errors) };
  }
  const householdMeta = household as Record<string, unknown>;
  const householdId = householdMeta.id;
  const householdName = householdMeta.name;
  const householdOwner = householdMeta.owner_id;
  if (typeof householdId !== "string" || !UUID_RE.test(householdId)) errors.push("The household ID in the backup is missing or invalid.");
  if (typeof householdName !== "string" || householdName.trim() === "") errors.push("The household name in the backup is missing.");
  if (typeof householdOwner !== "string" || !UUID_RE.test(householdOwner)) errors.push("The household owner ID in the backup is missing or invalid.");

  const tablesRaw = root.tables;
  if (typeof tablesRaw !== "object" || tablesRaw === null) {
    errors.push("The file has no tables block.");
    return { ok: false, errors: finishErrors(errors) };
  }
  const tables = tablesRaw as Record<string, unknown>;
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(tables[table])) {
      errors.push(`The backup is missing the "${table}" section.`);
    }
  }
  if (errors.length > 0) return { ok: false, errors: finishErrors(errors) };

  const validatedRows: Record<RestoreDataTable, RestoreRow[]> = Object.create(null);
  const idSets: Record<BackupTable, Set<string>> = Object.create(null);

  for (const table of BACKUP_TABLES) {
    const rows = (tables[table] ?? []) as Record<string, unknown>[];
    const seen = new Set<string>();
    for (const row of rows) {
      if (typeof row !== "object" || row === null) {
        errors.push(`${table}: a row isn't an object.`);
        break;
      }
      if (typeof row.id !== "string" || !UUID_RE.test(row.id)) {
        errors.push(`${table}: a row has a missing or invalid id.`);
        break;
      }
      if (seen.has(row.id)) {
        errors.push(`${table}: row id ${row.id} appears more than once.`);
      } else {
        seen.add(row.id);
      }
    }
    idSets[table] = seen;
  }

  const rowsByTable = () => {
    const map: Partial<Record<BackupTable, Record<string, unknown>[]>> = {};
    for (const table of BACKUP_TABLES) map[table] = (tables[table] ?? []) as Record<string, unknown>[];
    return map;
  };

  const allRows = rowsByTable();

  const counts = Object.fromEntries(
    RESTORE_DATA_TABLES.map((table) => [table, allRows[table]!.length])
  ) as Record<RestoreDataTable, number>;

  const householdRows = allRows.households ?? [];
  if (householdRows.length !== 1) {
    errors.push(`Expected exactly one households row, found ${householdRows.length}.`);
  } else if (householdRows[0].id !== householdId) {
    warnings.push("The households row doesn't match the household block — the household block wins.");
  }

  for (const table of RESTORE_DATA_TABLES) {
    const spec = SPECS[table];
    const out: RestoreRow[] = [];
    for (const source of allRows[table] ?? []) {
      const row: Record<string, unknown> = { ...source };
      delete row.import_batch_id;

      if (typeof row.household_id !== "string" || !UUID_RE.test(row.household_id)) {
        errors.push(`${table}: a row has a missing or invalid household_id.`);
        break;
      }
      if (row.household_id !== householdId) {
        errors.push(`${table}: row ${row.id} belongs to a different household than the backup's household.`);
        continue;
      }

      for (const [field, fieldSpec] of Object.entries(spec) as [string, FieldSpec][]) {
        const value = row[field];
        if (value === undefined || value === null) {
          if (fieldSpec.required) {
            errors.push(`${table}: row ${row.id} is missing the required field "${field}".`);
          }
          continue;
        }
        if (fieldSpec.type === "uuid") {
          if (typeof value !== "string" || !UUID_RE.test(value)) {
            errors.push(`${table}: row ${row.id} has an invalid ${field} (expected a UUID).`);
          }
        } else if (fieldSpec.type === "enum") {
          if (!fieldSpec.values.has(String(value))) {
            errors.push(`${table}: row ${row.id} has an unsupported ${field} (${String(value)}).`);
          }
        } else if (fieldSpec.type === "bool") {
          if (typeof value !== "boolean") {
            errors.push(`${table}: row ${row.id} has an invalid ${field} (expected true/false).`);
          }
        } else if (fieldSpec.type === "number") {
          const numeric = normalizeNumber(value);
          if (numeric === null) {
            errors.push(`${table}: row ${row.id} has an invalid ${field} (expected a number).`);
          } else {
            if (fieldSpec.min !== undefined && numeric < fieldSpec.min) {
              errors.push(`${table}: row ${row.id} has ${field} below ${fieldSpec.min}.`);
            }
            row[field] = numeric;
          }
        } else if (typeof value !== "string") {
          errors.push(`${table}: row ${row.id} has an invalid ${field} (expected text).`);
        }
      }

      const monthFields = MONTH_FIELDS[table];
      if (monthFields) {
        for (const field of monthFields) {
          const value = row[field];
          if (value === null || value === undefined) continue;
          if (typeof value !== "string" || !MONTH_RE.test(value)) {
            errors.push(`${table}: row ${row.id} has an invalid month in ${field} (expected YYYY-MM-01).`);
          }
        }
      }
      const dateFields = DATE_TABLE_FIELDS[table];
      if (dateFields) {
        for (const field of dateFields) {
          const value = row[field];
          if (value === null || value === undefined) continue;
          if (typeof value !== "string" || !DATE_RE.test(value) || Number.isNaN(new Date(value).getTime())) {
            errors.push(`${table}: row ${row.id} has an invalid date in ${field}.`);
          }
        }
      }
      out.push(row as RestoreRow);
    }
    validatedRows[table] = out;
  }

  categoryReferences(validatedRows, idSets, errors, warnings);

  if (errors.length > 0) return { ok: false, errors: finishErrors(errors) };

  const payload: ValidatedRestorePayload = {
    household: {
      id: householdId as string,
      name: (householdName as string).trim(),
      owner_id: householdOwner as string,
    },
    exported_at: root.exported_at as string,
    tables: validatedRows as Record<RestoreDataTable, RestoreRow[]>,
  };

  return {
    ok: true,
    payload,
    counts: counts as Record<RestoreDataTable, number>,
    warnings,
  };
}

type RowsMap = Partial<Record<RestoreDataTable, RestoreRow[]>>;

function categoryReferences(
  validated: RowsMap,
  idSets: Partial<Record<RestoreDataTable, Set<string>>>,
  errors: string[],
  warnings: string[]
) {
  const categoryIds = idSets.categories ?? new Set<string>();
  const cardIds = idSets.cards ?? new Set<string>();
  const accountIds = idSets.accounts ?? new Set<string>();
  const recurringIds = idSets.recurring_items ?? new Set<string>();
  const groupIds = idSets.category_groups ?? new Set<string>();

  for (const [table, field, idSet] of [
    ["recurring_items", "category_id", categoryIds],
    ["ledger_entries", "category_id", categoryIds],
    ["recurring_items", "card_id", cardIds],
    ["ledger_entries", "card_id", cardIds],
    ["ledger_entries", "recurring_item_id", recurringIds],
    ["account_balances", "account_id", accountIds],
    ["categories", "group_id", groupIds],
  ] as [RestoreDataTable, string, Set<string>][]) {
    for (const row of validated[table] ?? []) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      if (!idSet.has(value as string)) {
        errors.push(`${table}: row ${row.id} references a ${field.replace("_id", "")} (${value}) that isn't in the backup.`);
      }
    }
  }

  const kindByid = new Map((validated.categories ?? []).map((row) => [row.id, row.kind]));
  for (const row of validated.ledger_entries ?? []) {
    const categoryKind = kindByid.get(row.category_id as string);
    if (categoryKind && categoryKind !== row.kind) {
      warnings.push(`Entry ${row.id}: the backup's kind (${row.kind}) differs from its category (${categoryKind}) and will be corrected on restore.`);
    }
  }

  const nameSeen = new Set<string>();
  for (const row of validated.categories ?? []) {
    const key = `${row.kind}:${row.name}`;
    if (nameSeen.has(key)) {
      warnings.push(`Duplicate category name "${row.name}" — renaming may be needed on restore.`);
    }
    nameSeen.add(key);
  }
}

function finishErrors(errors: string[]): string[] {
  return [...new Set(errors)].slice(0, 20);
}
