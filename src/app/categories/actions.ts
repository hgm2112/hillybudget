"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/session";
import { toMonthKey } from "@/lib/month";
import { CATEGORY_ICON_NAMES } from "@/lib/category-icons";

export type ActionResult = { error?: string };

export type CategoryKind = "expense" | "income";

type CategoryPatch = Partial<{
  name: string;
  color: string;
  kind: CategoryKind;
  archived: boolean;
  excluded: boolean;
  group_id: string | null;
  ideal_override: number | null;
  icon: string | null;
}>;
type RecurringPatch = Partial<{ enabled: boolean; amount: number; card_id: string | null }>;
type CardPatch = Partial<{ name: string; color: string; archived: boolean }>;
type GroupPatch = Partial<{ name: string; color: string }>;

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const ICON_NAMES = new Set(CATEGORY_ICON_NAMES);

async function context() {
  const membership = await requireHousehold();
  const supabase = await createClient();
  return { supabase, householdId: membership.household_id };
}

export async function addCategory(input: {
  name: string;
  kind: CategoryKind;
  color: string;
  icon?: string | null;
}): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  if (!COLOR_RE.test(input.color)) return { error: "Invalid color." };
  const icon = input.icon ?? null;
  if (icon !== null && !ICON_NAMES.has(icon)) return { error: "Invalid icon." };
  const kind: CategoryKind = input.kind === "income" ? "income" : "expense";

  const { supabase, householdId } = await context();
  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("categories").insert({
    household_id: householdId,
    name,
    kind,
    color: input.color,
    icon,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) {
    if (error.code === "23505") return { error: `A category named "${name}" already exists.` };
    return { error: error.message };
  }

  revalidatePath("/categories");
  return {};
}

export async function updateCategory(id: string, patch: CategoryPatch): Promise<ActionResult> {
  const clean: CategoryPatch = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { error: "Name is required." };
    clean.name = name;
  }
  if (patch.color !== undefined) {
    if (!COLOR_RE.test(patch.color)) return { error: "Invalid color." };
    clean.color = patch.color;
  }
  if (patch.kind !== undefined) clean.kind = patch.kind === "income" ? "income" : "expense";
  if (patch.archived !== undefined) clean.archived = patch.archived;
  if (patch.excluded !== undefined) clean.excluded = patch.excluded;
  if (patch.group_id !== undefined) clean.group_id = patch.group_id;
  if (patch.icon !== undefined) {
    if (patch.icon !== null && !ICON_NAMES.has(patch.icon)) return { error: "Invalid icon." };
    clean.icon = patch.icon;
  }
  if (patch.ideal_override !== undefined) {
    if (patch.ideal_override === null) {
      clean.ideal_override = null;
    } else if (!Number.isFinite(patch.ideal_override) || patch.ideal_override < 0) {
      return { error: "Budget must be a positive number." };
    } else {
      clean.ideal_override = Math.round(patch.ideal_override * 100) / 100;
    }
  }
  if (Object.keys(clean).length === 0) return {};

  const { supabase, householdId } = await context();
  if (clean.group_id) {
    const { data: group } = await supabase
      .from("category_groups")
      .select("id")
      .eq("id", clean.group_id)
      .eq("household_id", householdId)
      .maybeSingle();
    if (!group) return { error: "Group not found." };
  }
  const { error } = await supabase.from("categories").update(clean).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/categories");
  return {};
}

export async function moveCategory(id: string, direction: -1 | 1): Promise<ActionResult> {
  const { supabase, householdId } = await context();
  const { data } = await supabase
    .from("categories")
    .select("id, sort_order")
    .eq("household_id", householdId)
    .order("sort_order");
  const list = data ?? [];
  const index = list.findIndex((row) => row.id === id);
  const target = list[index + direction];
  if (index < 0 || !target) return {};

  await supabase.from("categories").update({ sort_order: target.sort_order }).eq("id", id);
  await supabase.from("categories").update({ sort_order: list[index].sort_order }).eq("id", target.id);

  revalidatePath("/categories");
  return {};
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  const { count } = await supabase
    .from("ledger_entries")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);

  if (count && count > 0) {
    const { error } = await supabase.from("categories").update({ archived: true }).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return { error: error.message };
  }

  revalidatePath("/categories");
  return {};
}

export async function addCard(input: { name: string; color: string }): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  if (!COLOR_RE.test(input.color)) return { error: "Invalid color." };

  const { supabase, householdId } = await context();
  const { data: last } = await supabase
    .from("cards")
    .select("sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("cards").insert({
    household_id: householdId,
    name,
    color: input.color,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) {
    if (error.code === "23505") return { error: `A payment method named "${name}" already exists.` };
    return { error: error.message };
  }

  revalidatePath("/categories");
  return {};
}

export async function updateCard(id: string, patch: CardPatch): Promise<ActionResult> {
  const clean: CardPatch = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { error: "Name is required." };
    clean.name = name;
  }
  if (patch.color !== undefined) {
    if (!COLOR_RE.test(patch.color)) return { error: "Invalid color." };
    clean.color = patch.color;
  }
  if (patch.archived !== undefined) clean.archived = patch.archived;
  if (Object.keys(clean).length === 0) return {};

  const { supabase } = await context();
  const { error } = await supabase.from("cards").update(clean).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/categories");
  return {};
}

export async function deleteCard(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  const { error } = await supabase.from("cards").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/categories");
  return {};
}

export async function saveIdealWindow(value: string): Promise<ActionResult> {
  if (!["all", "trailing12", "trailing6"].includes(value)) return { error: "Invalid window." };

  const { supabase, householdId } = await context();
  const { error } = await supabase
    .from("household_settings")
    .upsert({ household_id: householdId, ideal_window: value }, { onConflict: "household_id" });
  if (error) return { error: error.message };

  revalidatePath("/categories");
  return {};
}

export async function addGroup(input: { name: string; color: string }): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  if (!COLOR_RE.test(input.color)) return { error: "Invalid color." };

  const { supabase, householdId } = await context();
  const { data: last } = await supabase
    .from("category_groups")
    .select("sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("category_groups").insert({
    household_id: householdId,
    name,
    color: input.color,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) {
    if (error.code === "23505") return { error: `A group named "${name}" already exists.` };
    return { error: error.message };
  }

  revalidatePath("/categories");
  return {};
}

export async function updateGroup(id: string, patch: GroupPatch): Promise<ActionResult> {
  const clean: GroupPatch = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { error: "Name is required." };
    clean.name = name;
  }
  if (patch.color !== undefined) {
    if (!COLOR_RE.test(patch.color)) return { error: "Invalid color." };
    clean.color = patch.color;
  }
  if (Object.keys(clean).length === 0) return {};

  const { supabase } = await context();
  const { error } = await supabase.from("category_groups").update(clean).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/categories");
  return {};
}

export async function moveGroup(id: string, direction: -1 | 1): Promise<ActionResult> {
  const { supabase, householdId } = await context();
  const { data } = await supabase
    .from("category_groups")
    .select("id, sort_order")
    .eq("household_id", householdId)
    .order("sort_order");
  const list = data ?? [];
  const index = list.findIndex((row) => row.id === id);
  const target = list[index + direction];
  if (index < 0 || !target) return {};

  await supabase.from("category_groups").update({ sort_order: target.sort_order }).eq("id", id);
  await supabase.from("category_groups").update({ sort_order: list[index].sort_order }).eq("id", target.id);

  revalidatePath("/categories");
  return {};
}

export async function deleteGroup(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  const { error } = await supabase.from("category_groups").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/categories");
  return {};
}

export async function setCategoryGroup(id: string, groupId: string | null): Promise<ActionResult> {
  return updateCategory(id, { group_id: groupId });
}

export async function setExcluded(id: string, excluded: boolean): Promise<ActionResult> {
  return updateCategory(id, { excluded });
}

export async function setCategoryRecurring(categoryId: string, patch: RecurringPatch): Promise<ActionResult> {
  if (!categoryId) return { error: "Category is required." };
  if (patch.amount !== undefined && (!Number.isFinite(patch.amount) || patch.amount < 0)) {
    return { error: "Amount must be a non-negative number." };
  }

  const { supabase, householdId } = await context();

  const { data: category } = await supabase
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!category) return { error: "Category not found." };

  if (patch.card_id) {
    const { data: card } = await supabase
      .from("cards")
      .select("id")
      .eq("id", patch.card_id)
      .eq("household_id", householdId)
      .maybeSingle();
    if (!card) return { error: "Payment method not found." };
  }

  const { data: existing } = await supabase
    .from("recurring_items")
    .select("id")
    .eq("household_id", householdId)
    .eq("category_id", categoryId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const update: Record<string, unknown> = {};
  if (patch.amount !== undefined) update.amount = Math.round(patch.amount * 100) / 100;
  if (patch.card_id !== undefined) update.card_id = patch.card_id;
  if (patch.enabled !== undefined) update.active = patch.enabled;

  if (existing) {
    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from("recurring_items").update(update).eq("id", existing.id);
      if (error) return { error: error.message };
    }
  } else if (patch.enabled !== false) {
    const { error } = await supabase.from("recurring_items").insert({
      household_id: householdId,
      category_id: categoryId,
      amount: patch.amount !== undefined ? Math.round(patch.amount * 100) / 100 : 0,
      card_id: patch.card_id ?? null,
      note: null,
      start_month: toMonthKey(new Date()),
      end_month: null,
      active: patch.enabled ?? true,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/categories");
  return {};
}
