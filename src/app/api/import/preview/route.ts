import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveHousehold } from "@/lib/household";
import { normalizeImportFile } from "@/lib/import/normalize";

type ExistingEntry = {
  month: string;
  category_id: string;
  card_id: string | null;
  amount: number;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const membership = await resolveHousehold(supabase, userData.user.id);

  if (!membership) {
    return NextResponse.json({ error: "No household found for this account" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A workbook file is required" }, { status: 400 });
  }

  let preview;
  try {
    preview = normalizeImportFile(file.name, Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read workbook" },
      { status: 400 }
    );
  }

  const householdId = membership.household_id;
  const [{ data: categories }, { data: cards }, { data: accounts }, { data: entries }, { data: balances }] =
    await Promise.all([
      supabase.from("categories").select("id, name").eq("household_id", householdId),
      supabase.from("cards").select("id, name").eq("household_id", householdId),
      supabase.from("accounts").select("id, name").eq("household_id", householdId),
      supabase.from("ledger_entries").select("month, category_id, card_id, amount").eq("household_id", householdId).not("import_batch_id", "is", null),
      supabase.from("account_balances").select("account_id, month").eq("household_id", householdId),
    ]);

  const categoryByName = new Map((categories ?? []).map((row) => [row.name, row.id]));
  const cardByName = new Map((cards ?? []).map((row) => [row.name, row.id]));
  const accountByName = new Map((accounts ?? []).map((row) => [row.name, row.id]));

  const existingEntryKeys = new Set(
    ((entries ?? []) as ExistingEntry[]).map(
      (entry) => `${entry.month}|${entry.category_id}|${entry.card_id ?? ""}|${Number(entry.amount)}`
    )
  );
  const existingBalanceKeys = new Set(
    (balances ?? []).map((row) => `${row.account_id}|${row.month}`)
  );

  let duplicateEntries = 0;
  for (const entry of preview.entries) {
    const categoryId = categoryByName.get(entry.category);
    if (!categoryId) continue;
    let cardId: string | null = null;
    if (entry.card) {
      const found = cardByName.get(entry.card);
      if (!found) continue;
      cardId = found;
    }
    if (existingEntryKeys.has(`${entry.month}|${categoryId}|${cardId ?? ""}|${entry.amount}`)) duplicateEntries += 1;
  }

  let duplicateBalanceConflicts = 0;
  for (const account of preview.accounts) {
    const accountId = accountByName.get(account.name);
    if (!accountId) continue;
    for (const balance of account.balances) {
      if (existingBalanceKeys.has(`${accountId}|${balance.month}`)) duplicateBalanceConflicts += 1;
    }
  }

  return NextResponse.json({
    preview: {
      sourceFileName: file.name,
      sheets: preview.sheets,
      monthRange: preview.monthRange,
      entriesByMonth: preview.entriesByMonth,
      errors: preview.errors,
      warnings: preview.warnings,
      categories: preview.categories.map((category) => ({
        ...category,
        exists: categoryByName.has(category.name),
      })),
      cards: preview.cards.map((card) => ({ ...card, exists: cardByName.has(card.name) })),
      accounts: preview.accounts.map((account) => ({
        name: account.name,
        kind: account.kind,
        color: account.color,
        balanceCount: account.balances.length,
        exists: accountByName.has(account.name),
      })),
      counts: {
        categories: preview.categories.length,
        cards: preview.cards.length,
        accounts: preview.accounts.length,
        entries: preview.entryCount,
        balances: preview.balanceCount,
      },
      sampleEntries: preview.entries.slice(0, 100),
    },
    duplicates: {
      entries: duplicateEntries,
      balances: duplicateBalanceConflicts,
    },
  });
}
