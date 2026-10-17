"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/session";

export type ActionResult = { error?: string };

export type AccountKind = "liquid" | "retirement" | "loan";

type AccountPatch = Partial<{
  name: string;
  kind: AccountKind;
  color: string;
  original_amount: number | null;
  interest_rate: number | null;
  monthly_payment: number | null;
  start_date: string | null;
}>;

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const MONTH_RE = /^\d{4}-\d{2}-01$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function context() {
  const membership = await requireHousehold();
  const supabase = await createClient();
  return { supabase, householdId: membership.household_id };
}

function optionalNumber(value: number | null): number | null {
  if (value === null) return null;
  return Number.isFinite(value) ? value : NaN;
}

export async function saveBalances(
  month: string,
  items: { accountId: string; balance: number }[]
): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };
  const clean = items.filter((item) => item.accountId && Number.isFinite(item.balance));
  if (clean.length === 0) return { error: "Enter a valid number." };

  const { supabase, householdId } = await context();
  const { error } = await supabase.from("account_balances").upsert(
    clean.map((item) => ({
      household_id: householdId,
      account_id: item.accountId,
      month,
      balance: item.balance,
    })),
    { onConflict: "account_id,month" }
  );
  if (error) return { error: error.message };

  await supabase.from("skipped_months").delete().eq("household_id", householdId).eq("month", month);

  revalidatePath("/accounts");
  return {};
}

export async function skipMonth(month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };

  const { supabase, householdId } = await context();

  const { data: existing } = await supabase
    .from("account_balances")
    .select("id")
    .eq("household_id", householdId)
    .eq("month", month)
    .limit(1)
    .maybeSingle();
  if (existing) return { error: "This month already has balances. Clear them before skipping." };

  const { error } = await supabase
    .from("skipped_months")
    .upsert({ household_id: householdId, month }, { onConflict: "household_id,month" });
  if (error) return { error: error.message };

  revalidatePath("/accounts");
  return {};
}

export async function unskipMonth(month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };

  const { supabase, householdId } = await context();
  const { error } = await supabase
    .from("skipped_months")
    .delete()
    .eq("household_id", householdId)
    .eq("month", month);
  if (error) return { error: error.message };

  revalidatePath("/accounts");
  return {};
}

export async function clearBalances(month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };

  const { supabase, householdId } = await context();
  const { error } = await supabase
    .from("account_balances")
    .delete()
    .eq("household_id", householdId)
    .eq("month", month);
  if (error) return { error: error.message };

  revalidatePath("/accounts");
  return {};
}

export async function archiveAccount(accountId: string, month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };

  const { supabase, householdId } = await context();
  const { data: ongoing } = await supabase
    .from("account_archive_periods")
    .select("id, start_month")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .is("end_month", null)
    .maybeSingle();

  if (ongoing) {
    if (String(ongoing.start_month) <= month) return {};
    const { error } = await supabase
      .from("account_archive_periods")
      .update({ start_month: month })
      .eq("id", ongoing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("account_archive_periods")
      .insert({ household_id: householdId, account_id: accountId, start_month: month });
    if (error) return { error: error.message };
  }

  revalidatePath("/accounts");
  return {};
}

export async function unarchiveAccount(accountId: string, month: string): Promise<ActionResult> {
  if (!MONTH_RE.test(month)) return { error: "Invalid month." };

  const { supabase, householdId } = await context();
  const { data: covering } = await supabase
    .from("account_archive_periods")
    .select("id, start_month")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .lte("start_month", month)
    .or(`end_month.is.null,end_month.gt.${month}`)
    .maybeSingle();

  if (!covering) return {};

  if (String(covering.start_month) >= month) {
    const { error } = await supabase.from("account_archive_periods").delete().eq("id", covering.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("account_archive_periods")
      .update({ end_month: month })
      .eq("id", covering.id);
    if (error) return { error: error.message };
  }

  revalidatePath("/accounts");
  return {};
}

export async function addAccount(input: {
  name: string;
  kind: AccountKind;
  color: string;
  original_amount: number | null;
  interest_rate: number | null;
  monthly_payment: number | null;
  start_date: string | null;
}): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  if (!COLOR_RE.test(input.color)) return { error: "Invalid color." };
  const kind: AccountKind = ["liquid", "retirement", "loan"].includes(input.kind) ? input.kind : "liquid";
  if (input.start_date && !DATE_RE.test(input.start_date)) return { error: "Invalid start date." };

  const { supabase, householdId } = await context();
  const { data: last } = await supabase
    .from("accounts")
    .select("sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("accounts").insert({
    household_id: householdId,
    name,
    kind,
    color: input.color,
    sort_order: (last?.sort_order ?? -1) + 1,
    original_amount: optionalNumber(input.original_amount),
    interest_rate: optionalNumber(input.interest_rate),
    monthly_payment: optionalNumber(input.monthly_payment),
    start_date: input.start_date,
  });
  if (error) return { error: error.message };

  revalidatePath("/accounts");
  return {};
}

export async function updateAccount(id: string, patch: AccountPatch): Promise<ActionResult> {
  const clean: AccountPatch = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { error: "Name is required." };
    clean.name = name;
  }
  if (patch.kind !== undefined) clean.kind = patch.kind;
  if (patch.color !== undefined) {
    if (!COLOR_RE.test(patch.color)) return { error: "Invalid color." };
    clean.color = patch.color;
  }
  if (patch.original_amount !== undefined) clean.original_amount = optionalNumber(patch.original_amount);
  if (patch.interest_rate !== undefined) clean.interest_rate = optionalNumber(patch.interest_rate);
  if (patch.monthly_payment !== undefined) clean.monthly_payment = optionalNumber(patch.monthly_payment);
  if (patch.start_date !== undefined) {
    if (patch.start_date && !DATE_RE.test(patch.start_date)) return { error: "Invalid start date." };
    clean.start_date = patch.start_date || null;
  }
  if (Object.keys(clean).length === 0) return {};

  const { supabase } = await context();
  const { error } = await supabase.from("accounts").update(clean).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounts");
  return {};
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  const { supabase } = await context();
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounts");
  return {};
}
