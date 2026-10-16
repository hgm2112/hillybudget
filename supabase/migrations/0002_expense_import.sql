create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  source_filename text,
  idempotency_key text,
  status text not null default 'started' check (status in ('started', 'completed', 'failed', 'duplicate')),
  row_counts jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, idempotency_key)
);

create index if not exists idx_import_batches_household on public.import_batches(household_id, created_at);

alter table public.import_batches enable row level security;

drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches for select to authenticated
  using (public.is_household_member(household_id));

grant select on public.import_batches to authenticated;
grant select, insert, update, delete on public.import_batches to service_role;

create or replace function public.import_expenses_batch(
  p_household_id uuid,
  p_idempotency_key text default null,
  p_payload jsonb default '{}'::jsonb,
  p_balances_mode text default 'skip'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_household uuid;
  v_key text := nullif(trim(p_idempotency_key), '');
  v_batch_id uuid := gen_random_uuid();
  v_existing record;
  v_lock bigint := hashtext(p_household_id::text);
  v_category text;
  v_color text;
  v_type text;
  v_cat_id uuid;
  v_card text;
  v_card_id uuid;
  v_acc text;
  v_acc_type text;
  v_acc_id uuid;
  v_month date;
  v_amount numeric(12,2);
  v_bal numeric(12,2);
  v_entry_matches bigint;
  v_balance_matches bigint;
  v_entries_inserted integer := 0;
  v_entries_skipped integer := 0;
  v_balances_inserted integer := 0;
  v_balances_updated integer := 0;
  v_balances_skipped integer := 0;
  v_categories_created integer := 0;
  v_cards_created integer := 0;
  v_accounts_created integer := 0;
  v_warnings jsonb := coalesce(p_payload->'warnings', '[]'::jsonb);
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_household
  from public.households
  where id = p_household_id
  for update;

  if v_household is null then
    raise exception 'Household not found';
  end if;

  select role = 'owner' into v_is_owner
  from public.household_members
  where household_id = p_household_id
    and user_id = v_uid;

  if coalesce(v_is_owner, false) is not true then
    raise exception 'Only household owners can import expenses';
  end if;

  perform pg_advisory_xact_lock(v_lock);

  if v_key is not null then
    select id, status, row_counts into v_existing
    from public.import_batches
    where household_id = p_household_id
      and idempotency_key = v_key;

    if found then
      if v_existing.status = 'completed' then
        return jsonb_build_object(
          'batch_id', v_existing.id,
          'duplicate_request', true,
          'idempotency_key', v_key,
          'entries_inserted', coalesce((v_existing.row_counts->>'entries_inserted')::integer, 0),
          'entries_skipped_duplicates', coalesce((v_existing.row_counts->>'entries_skipped_duplicates')::integer, 0),
          'balances_inserted', coalesce((v_existing.row_counts->>'balances_inserted')::integer, 0),
          'balances_updated', coalesce((v_existing.row_counts->>'balances_updated')::integer, 0),
          'balances_skipped', coalesce((v_existing.row_counts->>'balances_skipped')::integer, 0),
          'categories_created', coalesce((v_existing.row_counts->>'categories_created')::integer, 0),
          'cards_created', coalesce((v_existing.row_counts->>'cards_created')::integer, 0),
          'accounts_created', coalesce((v_existing.row_counts->>'accounts_created')::integer, 0)
        );
      end if;
      raise exception 'A previous import with this request key did not complete';
    end if;
  end if;

  insert into public.import_batches (id, household_id, requested_by, source_filename, idempotency_key, status, warnings)
  values (
    v_batch_id,
    p_household_id,
    v_uid,
    nullif(trim(coalesce(p_payload->>'sourceFileName', '')), ''),
    v_key,
    'started',
    v_warnings
  );

  for v_color, v_type, v_category in
    select coalesce(c->>'color', '#6b7280'), coalesce(c->>'type', 'expense'), c->>'name'
    from jsonb_array_elements(coalesce(p_payload->'categories', '[]'::jsonb)) as c
  loop
    v_cat_id := null;
    if nullif(trim(coalesce(v_category, '')), '') is null then
      raise exception 'Import category row is missing a name';
    end if;

    v_category := trim(v_category);
    v_type := case when v_type = 'income' then 'income' else 'expense' end;

    insert into public.categories (household_id, name, color, type, sort_order, archived)
    values (
      p_household_id,
      v_category,
      case when v_color ~ '^#[0-9A-Fa-f]{6}$' then v_color else '#6b7280' end,
      v_type,
      (select coalesce(max(sort_order), -1) + 1 from public.categories where household_id = p_household_id),
      false
    )
    on conflict (household_id, name) do nothing
    returning id into v_cat_id;

    if v_cat_id is null then
      select id into v_cat_id
      from public.categories
      where household_id = p_household_id
        and name = v_category;
    else
      v_categories_created := v_categories_created + 1;
    end if;
  end loop;

  for v_color, v_card in
    select coalesce(c->>'color', '#6b7280'), c->>'name'
    from jsonb_array_elements(coalesce(p_payload->'cards', '[]'::jsonb)) as c
  loop
    v_card_id := null;
    if nullif(trim(coalesce(v_card, '')), '') is null then
      raise exception 'Import card row is missing a name';
    end if;

    v_card := trim(v_card);

    insert into public.cards (household_id, name, color, sort_order, archived)
    values (
      p_household_id,
      v_card,
      case when v_color ~ '^#[0-9A-Fa-f]{6}$' then v_color else '#6b7280' end,
      (select coalesce(max(sort_order), -1) + 1 from public.cards where household_id = p_household_id),
      false
    )
    on conflict (household_id, name) do nothing
    returning id into v_card_id;

    if v_card_id is null then
      select id into v_card_id
      from public.cards
      where household_id = p_household_id
        and name = v_card;
    else
      v_cards_created := v_cards_created + 1;
    end if;
  end loop;

  for v_color, v_acc_type, v_acc in
    select coalesce(a->>'color', '#6b7280'), coalesce(a->>'type', 'liquid'), a->>'name'
    from jsonb_array_elements(coalesce(p_payload->'accounts', '[]'::jsonb)) as a
  loop
    v_acc_id := null;
    if nullif(trim(coalesce(v_acc, '')), '') is null then
      raise exception 'Import account row is missing a name';
    end if;

    v_acc := trim(v_acc);
    v_acc_type := case
      when v_acc_type in ('liquid', 'retirement', 'loan') then v_acc_type
      else 'liquid'
    end;

    insert into public.accounts (household_id, name, type, color, sort_order, archived)
    values (
      p_household_id,
      v_acc,
      v_acc_type,
      case when v_color ~ '^#[0-9A-Fa-f]{6}$' then v_color else '#6b7280' end,
      (select coalesce(max(sort_order), -1) + 1 from public.accounts where household_id = p_household_id),
      false
    )
    on conflict (household_id, name) do nothing
    returning id into v_acc_id;

    if v_acc_id is null then
      select id into v_acc_id
      from public.accounts
      where household_id = p_household_id
        and name = v_acc;
    else
      v_accounts_created := v_accounts_created + 1;
    end if;
  end loop;

  for v_month, v_category, v_card, v_amount in
    select
      (e->>'month')::date,
      e->>'category',
      nullif(trim(coalesce(e->>'card', '')), ''),
      (e->>'amount')::numeric(12,2)
    from jsonb_array_elements(coalesce(p_payload->'entries', '[]'::jsonb)) as e
  loop
    select id into v_cat_id
    from public.categories
    where household_id = p_household_id
      and name = v_category;

    if v_cat_id is null then
      raise exception 'Import entry references an unknown category: %', coalesce(v_category, '<blank>');
    end if;

    v_card_id := null;
    if v_card is not null then
      select id into v_card_id
      from public.cards
      where household_id = p_household_id
        and name = v_card;

      if v_card_id is null then
        raise exception 'Import entry references an unknown card: %', v_card;
      end if;
    end if;

    select count(*) into v_entry_matches
    from public.entries
    where household_id = p_household_id
      and month = v_month
      and category_id = v_cat_id
      and is_imported = true
      and card_id is not distinct from v_card_id
      and amount = v_amount;

    if v_entry_matches = 0 then
      insert into public.entries (household_id, month, category_id, card_id, amount, note, is_imported)
      values (p_household_id, v_month, v_cat_id, v_card_id, v_amount, 'Imported from Excel', true);
      v_entries_inserted := v_entries_inserted + 1;
    else
      v_entries_skipped := v_entries_skipped + 1;
    end if;
  end loop;

  for v_acc, v_month, v_bal in
    select
      a->>'name',
      (b->>'month')::date,
      (b->>'balance')::numeric(12,2)
    from jsonb_array_elements(coalesce(p_payload->'accounts', '[]'::jsonb)) as a
    cross join lateral jsonb_array_elements(coalesce(a->'balances', '[]'::jsonb)) as b
  loop
    v_acc_id := null;
    select id into v_acc_id
    from public.accounts
    where household_id = p_household_id
      and name = v_acc;

    if v_acc_id is null then
      raise exception 'Import balance references an unknown account: %', coalesce(v_acc, '<blank>');
    end if;

    select count(*) into v_balance_matches
    from public.account_balances
    where account_id = v_acc_id
      and month = v_month;

    if v_balance_matches = 0 then
      insert into public.account_balances (household_id, account_id, month, balance)
      values (p_household_id, v_acc_id, v_month, v_bal);
      v_balances_inserted := v_balances_inserted + 1;
    else
      if lower(coalesce(p_balances_mode, 'skip')) = 'replace' then
        update public.account_balances
          set household_id = p_household_id,
              balance = v_bal,
              updated_at = now()
        where account_id = v_acc_id
          and month = v_month;
        v_balances_updated := v_balances_updated + 1;
      else
        v_balances_skipped := v_balances_skipped + 1;
      end if;
    end if;
  end loop;

  update public.import_batches
  set status = 'completed',
      row_counts = jsonb_build_object(
        'entries_inserted', v_entries_inserted,
        'entries_skipped_duplicates', v_entries_skipped,
        'balances_inserted', v_balances_inserted,
        'balances_updated', v_balances_updated,
        'balances_skipped', v_balances_skipped,
        'categories_created', v_categories_created,
        'cards_created', v_cards_created,
        'accounts_created', v_accounts_created
      ),
      updated_at = now()
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'duplicate_request', false,
    'household_id', p_household_id,
    'entries_inserted', v_entries_inserted,
    'entries_skipped_duplicates', v_entries_skipped,
    'balances_inserted', v_balances_inserted,
    'balances_updated', v_balances_updated,
    'balances_skipped', v_balances_skipped,
    'categories_created', v_categories_created,
    'cards_created', v_cards_created,
    'accounts_created', v_accounts_created,
    'warnings', v_warnings
  );
end;
$$;

grant execute on function public.import_expenses_batch(uuid, text, jsonb, text) to authenticated;
