export const BACKUP_APP = "hillybudget";
export const BACKUP_SCHEMA_VERSION = 1;

const NUMERIC_FIELDS = {
  households: [],
  household_members: [],
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
} as const;

export const BACKUP_TABLES = Object.keys(NUMERIC_FIELDS) as BackupTable[];

export type BackupTable = keyof typeof NUMERIC_FIELDS;

export type BackupRow = Record<string, unknown> & { id: string };

export type BackupPayload = {
  app: string;
  schema_version: number;
  exported_at: string;
  household: { id: string; name: string; owner_id: string };
  tables: Record<BackupTable, BackupRow[]>;
};

export function normalizeBackupRow(table: BackupTable, row: Record<string, unknown>): BackupRow {
  const normalized: Record<string, unknown> = { ...row };
  for (const field of NUMERIC_FIELDS[table]) {
    const value = normalized[field];
    if (value !== null && value !== undefined) normalized[field] = Number(value);
  }
  return normalized as BackupRow;
}

export function backupFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${BACKUP_APP}-backup-${y}-${m}-${d}.json`;
}

export function lastBackupKey(householdId: string): string {
  return `hillybudget:lastBackup:${householdId}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const BACKUP_STALE_MS = 31 * DAY_MS;

export function backupAgeInDays(stored: string, now = Date.now()): number | null {
  const time = new Date(stored).getTime();
  if (!Number.isFinite(time)) return null;
  const age = now - time;
  if (age <= BACKUP_STALE_MS) return null;
  return Math.floor(age / DAY_MS);
}

export function countBackupRecords(payload: BackupPayload): number {
  return BACKUP_TABLES.reduce((sum, table) => sum + (payload.tables[table]?.length ?? 0), 0);
}
