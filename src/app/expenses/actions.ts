"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/session";

export type ActionResult = { error?: string; inserted?: number };

const MONTH_RE = /^\d{4}-\d{2}-01$/;

async function context() {
  const membership = await requireHousehold();
  const supabase = await createClient();
  return { supabase, householdId: membership.household_id };
}

export async function addEntries(input: {
  month: string;
  categoryId: string;
  cardId: string | null;
  note: string | null;
  amounts: number[];
}): Promise<ActionResult> {
  if (!MONTH_RE.test(input.month)) return { error: "Invalid month." };
  if (!input.categoryId) return { error: "Category is required." };
  const amounts = input.amounts.filter((amount) => Number.isFinite(amount));
  if (amounts.length === 0) return { error: "Amount is required." };

  const { supabase, householdId } = await context();
  const { error } = await supabase.from("ledger_entries").insert(
    amounts.map((amount) => ({
      household_id: householdId,
      month: input.month,
      category_id: input.categoryId,
      card_id: input.cardId,
      amount,
      note: input.note || null,
    }))
  );
  if (error) return { error: error.message };

  revalidatePath("/expenses");
  return { inserted: amounts.length };
}

export async function updateEntry(input: {
  id: string;
  amount?: number;
  cardId?: string | null;
  note?: string | null;
  categoryId?: string;
}): Promise<ActionResult> {
  const patch: Record<string, unknown> = {};
  if (input.amount !== undefined) {
    if (!Number.isFinite(input.amount)) return { error: "Invalid amount." };
    patch.amount = input.amount;
  }
  if (input.cardId !== undefined) patch.card_id = input.cardId;
  if (input.note !== undefined) patch.note = input.note || null;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (Object.keys(patch).length === 0) return {};

  const { supabase } = await context();
  const { error } = await supabase.from("ledger_entries").update(patch).eq("id", input.id);
  if (error) return { error: error.message };

  revalidatePath("/expenses");
  return {};
}

export async function deleteEntry(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  const { error } = await supabase.from("ledger_entries").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/expenses");
  return {};
}

export async function pauseMonth(month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };
  const { supabase, householdId } = await context();

  const { error } = await supabase
    .from("paused_months")
    .upsert({ household_id: householdId, month }, { onConflict: "household_id,month" });
  if (error) return { error: error.message };

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/stats");
  revalidatePath("/categories");
  return {};
}

export async function resumeMonth(month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };
  const { supabase, householdId } = await context();

  const { error } = await supabase
    .from("paused_months")
    .delete()
    .eq("household_id", householdId)
    .eq("month", month);
  if (error) return { error: error.message };

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/stats");
  revalidatePath("/categories");
  return {};
}

export async function clearMonth(month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };
  const { supabase, householdId } = await context();

  const { data: expenseCategories, error: categoriesError } = await supabase
    .from("categories")
    .select("id")
    .eq("household_id", householdId)
    .eq("kind", "expense");
  if (categoriesError) return { error: categoriesError.message };

  const ids = (expenseCategories ?? []).map((category) => category.id);
  if (ids.length === 0) return {};

  const { error } = await supabase.from("ledger_entries").delete().eq("month", month).in("category_id", ids);
  if (error) return { error: error.message };

  revalidatePath("/expenses");
  return {};
}

export async function fillRecurring(month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };
  const { supabase, householdId } = await context();

  const { data: templates, error: templateError } = await supabase
    .from("recurring_items")
    .select("id, category_id, card_id, amount, note, start_month, end_month")
    .eq("household_id", householdId)
    .eq("active", true)
    .lte("start_month", month);
  if (templateError) return { error: templateError.message };

  const due = (templates ?? []).filter((template) => !template.end_month || template.end_month >= month);

  const { data: existing, error: existingError } = await supabase
    .from("ledger_entries")
    .select("recurring_item_id")
    .eq("household_id", householdId)
    .eq("month", month)
    .not("recurring_item_id", "is", null);
  if (existingError) return { error: existingError.message };

  const existingIds = new Set((existing ?? []).map((row) => row.recurring_item_id));
  const toInsert = due
    .filter((template) => !existingIds.has(template.id))
    .map((template) => ({
      household_id: householdId,
      month,
      category_id: template.category_id,
      card_id: template.card_id,
      amount: Number(template.amount),
      note: template.note,
      recurring_item_id: template.id,
    }));

  if (toInsert.length === 0) return { inserted: 0 };
  const { error } = await supabase.from("ledger_entries").insert(toInsert);
  if (error) return { error: error.message };

  revalidatePath("/expenses");
  return { inserted: toInsert.length };
}
