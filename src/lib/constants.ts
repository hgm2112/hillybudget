export interface DefaultCategory {
  name: string;
  color: string;
  type: "expense" | "income";
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Groceries", color: "#22c55e", type: "expense" },
  { name: "Eating Out", color: "#f97316", type: "expense" },
  { name: "Gas", color: "#eab308", type: "expense" },
  { name: "Electric", color: "#facc15", type: "expense" },
  { name: "Water", color: "#0ea5e9", type: "expense" },
  { name: "Mortgage", color: "#8b5cf6", type: "expense" },
  { name: "House Maintenance", color: "#a78bfa", type: "expense" },
  { name: "Car Gas", color: "#f59e0b", type: "expense" },
  { name: "Car Loan", color: "#7c3aed", type: "expense" },
  { name: "Trash", color: "#6b7280", type: "expense" },
  { name: "Internet", color: "#14b8a6", type: "expense" },
  { name: "Phone", color: "#06b6d4", type: "expense" },
  { name: "Ebay Earnings", color: "#16a34a", type: "income" },
  { name: "Ebay Spending", color: "#ef4444", type: "expense" },
  { name: "Magic the Gathering", color: "#ec4899", type: "expense" },
  { name: "Car Insurance", color: "#475569", type: "expense" },
  { name: "Spotify", color: "#1db954", type: "expense" },
  { name: "Tithe", color: "#64748b", type: "expense" },
  { name: "Travel", color: "#3b82f6", type: "expense" },
];
