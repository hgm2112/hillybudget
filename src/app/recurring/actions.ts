"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/session";

export type ActionResult = { error?: string };

type TemplatePatch = Partial<{
  amount: number;
  note: string | null;
  card_id: string | null;
  start_month: string;
  end_month: string | null;
  active: boolean;
}>;

const MONTH_RE = /^\d{4}-\d{2}-01$/;

async function context() {
  const membership = await requireHousehold();
  const supabase = await createClient();
  return { supabase, householdId: membership.household_id };
}

function validAmount(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export async function addTemplate(input: {
  category_id: string;
  card_id: string | null;
  amount: number;
  note: string | null;
  start_month: string;
  end_month: string | null;
  active: boolean;
}): Promise<ActionResult> {
  if (!input.category_id) return { error: "Category is required." };
  if (!validAmount(input.amount)) return { error: "Amount must be a non-negative number." };
  if (!MONTH_RE.test(input.start_month)) return { error: "Invalid start month." };
  if (input.end_month && !MONTH_RE.test(input.end_month)) return { error: "Invalid end month." };
  if (input.end_month && input.end_month < input.start_month) return { error: "End month cannot be before start month." };

  const { supabase, householdId } = await context();
  const { error } = await supabase.from("recurring_items").insert({
    household_id: householdId,
    category_id: input.category_id,
    card_id: input.card_id,
    amount: input.amount,
    note: input.note,
    start_month: input.start_month,
    end_month: input.end_month,
    active: input.active,
  });
  if (error) return { error: error.message };

  revalidatePath("/recurring");
  return {};
}

export async function toggleActive(id: string, active: boolean): Promise<ActionResult> {
  const { supabase } = await context();
  const { error } = await supabase.from("recurring_items").update({ active }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/recurring");
  return {};
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  const { error } = await supabase.from("recurring_items").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/recurring");
  return {};
}

export async function updateTemplate(id: string, patch: TemplatePatch): Promise<ActionResult> {
  const clean: TemplatePatch = {};
  if (patch.amount !== undefined) {
    if (!validAmount(patch.amount)) return { error: "Amount must be a non-negative number." };
    clean.amount = patch.amount;
  }
  if (patch.note !== undefined) clean.note = patch.note || null;
  if (patch.card_id !== undefined) clean.card_id = patch.card_id;
  if (patch.start_month !== undefined) {
    if (!MONTH_RE.test(patch.start_month)) return { error: "Invalid start month." };
    clean.start_month = patch.start_month;
  }
  if (patch.end_month !== undefined) {
    if (patch.end_month && !MONTH_RE.test(patch.end_month)) return { error: "Invalid end month." };
    clean.end_month = patch.end_month || null;
  }
  if (patch.active !== undefined) clean.active = patch.active;
  if (Object.keys(clean).length === 0) return {};

  const { supabase } = await context();
  const { data: current } = await supabase
    .from("recurring_items")
    .select("start_month")
    .eq("id", id)
    .maybeSingle();

  const start = clean.start_month ?? current?.start_month;
  const end = clean.end_month !== undefined ? clean.end_month : undefined;
  if (end && start && end < start) return { error: "End month cannot be before start month." };

  const { error } = await supabase.from("recurring_items").update(clean).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/recurring");
  return {};
}
