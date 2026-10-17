import { parseWorkbook } from "./xlsx";
import type {
  ImportIssue,
  ImportIssueLevel,
  ImportPreview,
  ProposedAccount,
  ProposedCard,
  ProposedCategory,
  ProposedEntry,
} from "./types";

const NUMERIC_LIMIT = 9999999999.99;

const EXPENSE_PALETTE: Record<string, string> = {
  Groceries: "#22c55e",
  "Eating Out": "#f97316",
  Gas: "#eab308",
  Electric: "#facc15",
  Water: "#0ea5e9",
  Mortgage: "#8b5cf6",
  "House Maintenance": "#a78bfa",
  "Car Gas": "#f59e0b",
  "Car Loan": "#7c3aed",
  Trash: "#6b7280",
  Internet: "#14b8a6",
  Phone: "#06b6d4",
  "Ebay Earnings": "#16a34a",
  "Ebay Spending": "#ef4444",
  "Magic the Gathering": "#ec4899",
  "Car Insurance": "#475569",
  Spotify: "#1db954",
  Tithe: "#64748b",
  Travel: "#3b82f6",
};

const EXPENSE_MONTHS: Record<string, string> = {
  C: "2025-01-01",
  D: "2025-02-01",
  E: "2025-03-01",
  F: "2025-04-01",
  G: "2025-05-01",
  H: "2025-06-01",
  I: "2025-07-01",
  J: "2025-08-01",
  K: "2025-09-01",
  L: "2025-10-01",
  M: "2025-11-01",
  N: "2025-12-01",
  O: "2026-01-01",
  P: "2026-02-01",
  Q: "2026-03-01",
  R: "2026-04-01",
  S: "2026-05-01",
  T: "2026-06-01",
  U: "2026-07-01",
  V: "2026-08-01",
  W: "2026-09-01",
  X: "2026-10-01",
  Y: "2026-11-01",
  Z: "2026-12-01",
};

function makeIssue(level: ImportIssueLevel, source: string, message: string): ImportIssue {
  return { level, source, message };
}

function trimCell(value: string | undefined) {
  return (value ?? "").trim();
}

function parseDecimal(value: string | undefined, source: string, errors: ImportIssue[]) {
  const text = trimCell(value);
  if (text === "") return null;
  const number = Number(text);
  if (!Number.isFinite(number)) {
    errors.push(makeIssue("error", source, `Invalid numeric value "${text}"`));
    return null;
  }
  const rounded = Number(number.toFixed(2));
  if (Math.abs(rounded) > NUMERIC_LIMIT) {
    errors.push(makeIssue("error", source, `Value "${text}" is out of range`));
    return null;
  }
  return rounded;
}

function excelSerialToMonthKey(serial: string) {
  const value = Number(serial);
  if (!Number.isFinite(value)) return null;
  const ms = Math.round((value - 25569) * 86400000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}-01`;
}

function classifyAccount(name: string): ProposedAccount["kind"] {
  const lowered = name.toLowerCase();
  if (lowered.includes("mortgage") || lowered.includes("we owe") || lowered.includes("loan")) return "loan";
  if (/(401|ira|hsa|principal|schwab)/.test(lowered)) return "retirement";
  return "liquid";
}

function isSummaryRow(name: string) {
  return /^(total|change|net total)/i.test(name) || /net total$/i.test(name);
}

function monthRangeFrom(months: string[]) {
  if (months.length === 0) return "";
  const sorted = [...months].sort();
  return `${sorted[0].slice(0, 7)} to ${sorted[sorted.length - 1].slice(0, 7)}`;
}

export function normalizeImportFile(sourceFileName: string, buffer: Buffer): ImportPreview {
  const workbook = parseWorkbook(buffer);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  if (!workbook.sheetNames.includes("Expenses")) {
    throw new Error("Workbook is missing the required Expenses sheet");
  }

  const expensesSheet = workbook.sheets.Expenses;
  const accountSheet = workbook.sheets.Accounts;

  if (!accountSheet) {
    warnings.push(makeIssue("warning", "Workbook", "Accounts sheet was not found; only expense entries will be imported"));
  }

  const expenseRowNumbers = Object.keys(expensesSheet)
    .map(Number)
    .filter((rowNumber) => rowNumber !== 1)
    .sort((a, b) => a - b);

  const categories = new Map<string, ProposedCategory>();
  const cards = new Map<string, ProposedCard>();
  const entries: ProposedEntry[] = [];
  const entriesByMonth: Record<string, number> = {};
  const seenCategoryRows = new Set<string>();

  for (const rowNumber of expenseRowNumbers) {
    const row = expensesSheet[rowNumber];
    const categoryName = trimCell(row.A);
    if (!categoryName || isSummaryRow(categoryName)) continue;
    if (seenCategoryRows.has(categoryName)) {
      errors.push(makeIssue("error", `Expenses row ${rowNumber}`, `Duplicate category row "${categoryName}"`));
      continue;
    }
    seenCategoryRows.add(categoryName);

    const cardName = trimCell(row.B) || null;
    if (cardName && !cards.has(cardName)) {
      cards.set(cardName, { name: cardName, color: "#6b7280" });
    }

    categories.set(categoryName, {
      name: categoryName,
      kind: categoryName.toLowerCase().endsWith("earnings") ? "income" : "expense",
      color: EXPENSE_PALETTE[categoryName] ?? "#6b7280",
    });

    let monthCells = 0;
    for (const [column, month] of Object.entries(EXPENSE_MONTHS)) {
      const amount = parseDecimal(row[column], `Expenses ${categoryName} ${month.slice(0, 7)}`, errors);
      if (amount === null) continue;
      entries.push({ month, category: categoryName, card: cardName, amount });
      entriesByMonth[month] = (entriesByMonth[month] ?? 0) + 1;
      monthCells += 1;
    }
    if (monthCells === 0) {
      warnings.push(makeIssue("warning", `Expenses ${categoryName}`, `Category "${categoryName}" has no monthly values`));
    }
  }

  const accounts = new Map<string, ProposedAccount>();
  let balanceCount = 0;

  if (accountSheet) {
    const accountRowNumbers = Object.keys(accountSheet)
      .map(Number)
      .filter((rowNumber) => rowNumber !== 1)
      .sort((a, b) => a - b);

    const header = accountSheet[1] ?? {};
    const monthColumns = Object.keys(header)
      .filter((column) => column !== "A" && column !== "B" && column !== "C")
      .sort();

    const seenAccountRows = new Set<string>();
    for (const rowNumber of accountRowNumbers) {
      const row = accountSheet[rowNumber];
      const accountName = trimCell(row.A);
      if (!accountName) continue;
      const lowered = accountName.toLowerCase();
      if (lowered.startsWith("total") || lowered.startsWith("change")) continue;
      if (seenAccountRows.has(accountName)) {
        errors.push(makeIssue("error", `Accounts row ${rowNumber}`, `Duplicate account row "${accountName}"`));
        continue;
      }
      seenAccountRows.add(accountName);

      const account: ProposedAccount = {
        name: accountName,
        kind: classifyAccount(accountName),
        color: "#6b7280",
        balances: [],
      };
      accounts.set(accountName, account);

      for (const column of monthColumns) {
        const cell = trimCell(row[column]);
        if (cell === "" || cell.toLowerCase() === "closed") continue;
        const amount = parseDecimal(cell, `Accounts ${accountName} ${column}`, errors);
        if (amount === null) continue;
        const month = excelSerialToMonthKey(header[column]);
        if (!month) {
          errors.push(makeIssue("error", "Accounts header", `Column ${column} does not contain a valid month date`));
          continue;
        }
        account.balances.push({ month, balance: amount });
        balanceCount += 1;
      }

      if (account.balances.length === 0) {
        warnings.push(makeIssue("warning", `Accounts ${accountName}`, `Account "${accountName}" has no balance snapshots`));
      }
    }
  }

  const allMonths = Array.from(
    new Set([
      ...entries.map((entry) => entry.month),
      ...Array.from(accounts.values()).flatMap((account) => account.balances.map((balance) => balance.month)),
    ])
  );

  return {
    sourceFileName,
    sheets: workbook.sheetNames,
    monthRange: monthRangeFrom(allMonths),
    categories: [...categories.values()],
    cards: [...cards.values()],
    accounts: [...accounts.values()],
    entries,
    entriesByMonth,
    entryCount: entries.length,
    balanceCount,
    warnings,
    errors,
  };
}
