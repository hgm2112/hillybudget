import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveHousehold } from "@/lib/household";
import { normalizeImportFile } from "@/lib/import/normalize";
import type { ProposedAccount, ProposedCategory } from "@/lib/import/types";

function parseOverrides<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[]) {
  if (typeof value !== "string" || value === "") return {} as Record<string, T>;
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    const result: Record<string, T> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if ((allowed as readonly string[]).includes(entry)) result[key] = entry as T;
    }
    return result;
  } catch {
    return {} as Record<string, T>;
  }
}

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
  if (membership.role !== "owner") {
    return NextResponse.json({ error: "Only household owners can import expenses" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A workbook file is required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let preview;
  try {
    preview = normalizeImportFile(file.name, buffer);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read workbook" },
      { status: 400 }
    );
  }

  if (preview.errors.length > 0) {
    return NextResponse.json(
      { error: "The workbook has validation errors", errors: preview.errors },
      { status: 400 }
    );
  }

  const categoryTypes = parseOverrides<ProposedCategory["type"]>(
    formData.get("categoryTypes"),
    ["expense", "income"]
  );
  const accountTypes = parseOverrides<ProposedAccount["type"]>(
    formData.get("accountTypes"),
    ["liquid", "retirement", "loan"]
  );
  const balancesMode = formData.get("balancesMode") === "replace" ? "replace" : "skip";

  const categories = preview.categories.map((category) => ({
    ...category,
    type: categoryTypes[category.name] ?? category.type,
  }));
  const accounts = preview.accounts.map((account) => ({
    ...account,
    type: accountTypes[account.name] ?? account.type,
  }));

  const idempotencyKey = createHash("sha256").update(buffer).digest("hex").slice(0, 40);

  const { data, error } = await supabase.rpc("import_expenses_batch", {
    p_household_id: membership.household_id,
    p_idempotency_key: idempotencyKey,
    p_payload: {
      sourceFileName: file.name,
      categories,
      cards: preview.cards,
      accounts,
      entries: preview.entries,
      warnings: preview.warnings,
    },
    p_balances_mode: balancesMode,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ result: data });
}
