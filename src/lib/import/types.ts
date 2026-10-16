export type ImportIssueLevel = "error" | "warning";

export type ImportIssue = {
  level: ImportIssueLevel;
  source: string;
  message: string;
};

export type ProposedCategory = {
  name: string;
  type: "expense" | "income";
  color: string;
};

export type ProposedCard = {
  name: string;
  color: string;
};

export type ProposedBalance = {
  month: string;
  balance: number;
};

export type ProposedAccount = {
  name: string;
  type: "liquid" | "retirement" | "loan";
  color: string;
  balances: ProposedBalance[];
};

export type ProposedEntry = {
  month: string;
  category: string;
  card: string | null;
  amount: number;
};

export type ImportPreview = {
  sourceFileName: string;
  sheets: string[];
  monthRange: string;
  categories: ProposedCategory[];
  cards: ProposedCard[];
  accounts: ProposedAccount[];
  entries: ProposedEntry[];
  entriesByMonth: Record<string, number>;
  entryCount: number;
  balanceCount: number;
  warnings: ImportIssue[];
  errors: ImportIssue[];
};
