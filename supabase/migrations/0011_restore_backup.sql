-- Restores a validated v1 backup into a brand-new household owned by the caller.
-- One transaction: if anything fails, the household, membership, settings,
-- and all imported rows roll back together. Never touches any existing
-- household, membership, profile, or auth user. import_batch_id is not
-- restored (import_batches rows are not part of a backup; FK is set null).
-- Every imported data row receives a fresh UUID. Old -> new ID mappings are
-- kept in jsonb variables for the five tables other rows can reference
-- (category_groups, categories, cards, accounts, recurring_items) and are
-- applied to every dependent foreign key, so a restore can never collide
-- with rows already in the database — including rows restored twice from
-- the same backup.

create or replace function public.restore_into_new_household(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid              uuid := auth.uid();
  v_hh               uuid := gen_random_uuid();
  v_name             text;
  v_code             text;
  v_exported_at      timestamptz;
  v_active_household uuid;
  v_is_owner         boolean;
  v_tables           jsonb;
  v_settings         jsonb;
  v_map_groups       jsonb;
  v_map_categories   jsonb;
  v_map_cards        jsonb;
  v_map_accounts     jsonb;
  v_map_recurring    jsonb;
  v_expected         integer;
  v_count            integer;
  t                  text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select m.household_id, (m.role = 'owner')
  into v_active_household, v_is_owner
  from public.household_members m
  where m.user_id = v_uid
  order by m.created_at asc, m.household_id asc
  limit 1;

  if v_active_household is null then
    raise exception 'You are not a member of a household.';
  end if;
  if v_is_owner is distinct from true then
    raise exception 'Only household owners can restore a backup.';
  end if;

  perform pg_advisory_xact_lock(hashtext('restore:' || v_uid::text));

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Backup must be a JSON object';
  end if;
  if p_payload->>'app' is distinct from 'hillybudget'
     or p_payload->>'schema_version' is distinct from '1' then
    raise exception 'Unsupported backup format';
  end if;

  v_exported_at := (p_payload->>'exported_at')::timestamptz;
  if v_exported_at is null then
    raise exception 'Backup has no readable export date';
  end if;

  if jsonb_typeof(p_payload->'household') is distinct from 'object' then
    raise exception 'Backup has no household block';
  end if;
  v_name := btrim(coalesce(p_payload->'household'->>'name', ''));
  if v_name = '' then
    raise exception 'Backup household name is missing';
  end if;
  if length(v_name) > 200 then
    raise exception 'Backup household name is too long';
  end if;

  if jsonb_typeof(p_payload->'tables') is distinct from 'object' then
    raise exception 'Backup has no tables block';
  end if;
  v_tables := p_payload->'tables';

  foreach t in array array[
    'households', 'household_members', 'household_settings', 'category_groups',
    'categories', 'cards', 'accounts', 'recurring_items', 'skipped_months',
    'account_archive_periods', 'ledger_entries', 'account_balances'
  ] loop
    if jsonb_typeof(v_tables->t) is distinct from 'array' then
      raise exception 'Backup section missing: %', t;
    end if;
  end loop;

  select s into v_settings
  from jsonb_array_elements(v_tables->'household_settings') s;

  if (select count(*) from jsonb_array_elements(v_tables->'household_settings')) > 1 then
    raise exception 'Multiple household settings rows in backup';
  end if;

  foreach t in array array[
    'category_groups', 'categories', 'cards', 'accounts', 'recurring_items',
    'skipped_months', 'account_archive_periods', 'ledger_entries', 'account_balances'
  ] loop
    if exists (
      select 1
      from jsonb_array_elements(v_tables->t) x
      group by x->>'id'
      having count(*) > 1
      limit 1
    ) then
      raise exception 'Duplicate row id in backup section: %', t;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(v_tables->'categories') c
    where c->>'group_id' is not null
      and not exists (
        select 1 from jsonb_array_elements(v_tables->'category_groups') g
        where g->>'id' = c->>'group_id'
      )
  ) then
    raise exception 'A category references a category group missing from the backup';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_tables->'recurring_items') r
    where not exists (
      select 1 from jsonb_array_elements(v_tables->'categories') c
      where c->>'id' = r->>'category_id'
    )
  ) then
    raise exception 'A recurring item references a category missing from the backup';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_tables->'recurring_items') r
    where r->>'card_id' is not null
      and not exists (
        select 1 from jsonb_array_elements(v_tables->'cards') c
        where c->>'id' = r->>'card_id'
      )
  ) then
    raise exception 'A recurring item references a card missing from the backup';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_tables->'ledger_entries') e
    where not exists (
      select 1 from jsonb_array_elements(v_tables->'categories') c
      where c->>'id' = e->>'category_id'
    )
  ) then
    raise exception 'An entry references a category missing from the backup';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_tables->'ledger_entries') e
    where e->>'card_id' is not null
      and not exists (
        select 1 from jsonb_array_elements(v_tables->'cards') c
        where c->>'id' = e->>'card_id'
      )
  ) then
    raise exception 'An entry references a card missing from the backup';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_tables->'ledger_entries') e
    where e->>'recurring_item_id' is not null
      and not exists (
        select 1 from jsonb_array_elements(v_tables->'recurring_items') r
        where r->>'id' = e->>'recurring_item_id'
      )
  ) then
    raise exception 'An entry references a recurring item missing from the backup';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_tables->'account_balances') b
    where not exists (
      select 1 from jsonb_array_elements(v_tables->'accounts') a
      where a->>'id' = b->>'account_id'
    )
  ) then
    raise exception 'Balance history references an account missing from the backup';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_tables->'account_archive_periods') p
    where not exists (
      select 1 from jsonb_array_elements(v_tables->'accounts') a
      where a->>'id' = p->>'account_id'
    )
  ) then
    raise exception 'An archive period references an account missing from the backup';
  end if;

  select coalesce(jsonb_object_agg((g->>'id'), gen_random_uuid()), '{}'::jsonb)
  into v_map_groups
  from jsonb_array_elements(v_tables->'category_groups') g;

  select coalesce(jsonb_object_agg((c->>'id'), gen_random_uuid()), '{}'::jsonb)
  into v_map_categories
  from jsonb_array_elements(v_tables->'categories') c;

  select coalesce(jsonb_object_agg((c->>'id'), gen_random_uuid()), '{}'::jsonb)
  into v_map_cards
  from jsonb_array_elements(v_tables->'cards') c;

  select coalesce(jsonb_object_agg((a->>'id'), gen_random_uuid()), '{}'::jsonb)
  into v_map_accounts
  from jsonb_array_elements(v_tables->'accounts') a;

  select coalesce(jsonb_object_agg((r->>'id'), gen_random_uuid()), '{}'::jsonb)
  into v_map_recurring
  from jsonb_array_elements(v_tables->'recurring_items') r;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.households h where h.invite_code = v_code);
  end loop;

  insert into public.households (id, name, invite_code, owner_id)
  values (v_hh, v_name, v_code, v_uid);

  insert into public.household_members (household_id, user_id, role)
  values (v_hh, v_uid, 'owner');

  insert into public.household_settings (household_id, ideal_window)
  values (v_hh, coalesce(btrim(v_settings->>'ideal_window'), 'trailing12'));

  insert into public.category_groups (id, household_id, name, color, sort_order, created_at, updated_at)
  select (v_map_groups ->> (g->>'id'))::uuid, v_hh, g->>'name',
         coalesce(g->>'color', '#6b7280'),
         coalesce((g->>'sort_order')::integer, 0),
         coalesce((g->>'created_at')::timestamptz, now()),
         coalesce((g->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'category_groups') g;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'category_groups');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'category_groups';
  end if;

  insert into public.categories (
    id, household_id, name, kind, color, sort_order, archived,
    ideal_override, excluded, icon, no_ideal, group_id, created_at, updated_at
  )
  select (v_map_categories ->> (c->>'id'))::uuid, v_hh, c->>'name',
         (c->>'kind')::public.category_kind,
         coalesce(c->>'color', '#6b7280'),
         coalesce((c->>'sort_order')::integer, 0),
         coalesce((c->>'archived')::boolean, false),
         (c->>'ideal_override')::numeric(12, 2),
         coalesce((c->>'excluded')::boolean, false),
         c->>'icon',
         coalesce((c->>'no_ideal')::boolean, false),
         (v_map_groups ->> (c->>'group_id'))::uuid,
         coalesce((c->>'created_at')::timestamptz, now()),
         coalesce((c->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'categories') c;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'categories');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'categories';
  end if;

  insert into public.cards (id, household_id, name, color, sort_order, archived, created_at, updated_at)
  select (v_map_cards ->> (c->>'id'))::uuid, v_hh, c->>'name',
         coalesce(c->>'color', '#6b7280'),
         coalesce((c->>'sort_order')::integer, 0),
         coalesce((c->>'archived')::boolean, false),
         coalesce((c->>'created_at')::timestamptz, now()),
         coalesce((c->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'cards') c;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'cards');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'cards';
  end if;

  insert into public.accounts (
    id, household_id, name, kind, color, sort_order, archived,
    original_amount, interest_rate, monthly_payment, start_date, created_at, updated_at
  )
  select (v_map_accounts ->> (a->>'id'))::uuid, v_hh, a->>'name',
         (a->>'kind')::public.account_kind,
         coalesce(a->>'color', '#6b7280'),
         coalesce((a->>'sort_order')::integer, 0),
         coalesce((a->>'archived')::boolean, false),
         (a->>'original_amount')::numeric(12, 2),
         (a->>'interest_rate')::numeric(8, 4),
         (a->>'monthly_payment')::numeric(12, 2),
         (a->>'start_date')::date,
         coalesce((a->>'created_at')::timestamptz, now()),
         coalesce((a->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'accounts') a;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'accounts');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'accounts';
  end if;

  insert into public.recurring_items (
    id, household_id, category_id, card_id, amount, note,
    start_month, end_month, active, created_at, updated_at
  )
  select (v_map_recurring ->> (r->>'id'))::uuid, v_hh,
         (v_map_categories ->> (r->>'category_id'))::uuid,
         (v_map_cards ->> (r->>'card_id'))::uuid,
         (r->>'amount')::numeric(12, 2),
         r->>'note',
         (r->>'start_month')::date,
         (r->>'end_month')::date,
         coalesce((r->>'active')::boolean, true),
         coalesce((r->>'created_at')::timestamptz, now()),
         coalesce((r->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'recurring_items') r;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'recurring_items');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'recurring_items';
  end if;

  insert into public.skipped_months (id, household_id, month, created_at)
  select gen_random_uuid(), v_hh,
         (s->>'month')::date,
         coalesce((s->>'created_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'skipped_months') s;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'skipped_months');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'skipped_months';
  end if;

  insert into public.account_archive_periods (id, household_id, account_id, start_month, end_month, created_at)
  select gen_random_uuid(), v_hh,
         (v_map_accounts ->> (p->>'account_id'))::uuid,
         (p->>'start_month')::date,
         (p->>'end_month')::date,
         coalesce((p->>'created_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'account_archive_periods') p;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'account_archive_periods');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'account_archive_periods';
  end if;

  insert into public.ledger_entries (
    id, household_id, month, category_id, card_id, kind, amount, note,
    recurring_item_id, created_by, created_at, updated_at
  )
  select gen_random_uuid(), v_hh,
         (e->>'month')::date,
         (v_map_categories ->> (e->>'category_id'))::uuid,
         (v_map_cards ->> (e->>'card_id'))::uuid,
         (coalesce(e->>'kind', 'expense'))::public.category_kind,
         (e->>'amount')::numeric(12, 2),
         e->>'note',
         (v_map_recurring ->> (e->>'recurring_item_id'))::uuid,
         u.id,
         coalesce((e->>'created_at')::timestamptz, now()),
         coalesce((e->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'ledger_entries') e
  left join auth.users u on u.id = (nullif(e->>'created_by', ''))::uuid;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'ledger_entries');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'ledger_entries';
  end if;

  insert into public.account_balances (
    id, household_id, account_id, month, balance, contributions, created_at, updated_at
  )
  select gen_random_uuid(), v_hh,
         (v_map_accounts ->> (b->>'account_id'))::uuid,
         (b->>'month')::date,
         (b->>'balance')::numeric(12, 2),
         (b->>'contributions')::numeric(12, 2),
         coalesce((b->>'created_at')::timestamptz, now()),
         coalesce((b->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(v_tables->'account_balances') b;
  get diagnostics v_count = row_count;
  v_expected := jsonb_array_length(v_tables->'account_balances');
  if v_count <> v_expected then
    raise exception 'Row count mismatch after inserting %', 'account_balances';
  end if;

  return jsonb_build_object(
    'household_id', v_hh,
    'household_name', v_name,
    'invite_code', v_code,
    'counts', jsonb_build_object(
      'household_settings', (select count(*) from public.household_settings where household_id = v_hh),
      'category_groups',    (select count(*) from public.category_groups    where household_id = v_hh),
      'categories',         (select count(*) from public.categories         where household_id = v_hh),
      'cards',              (select count(*) from public.cards              where household_id = v_hh),
      'accounts',           (select count(*) from public.accounts           where household_id = v_hh),
      'recurring_items',    (select count(*) from public.recurring_items    where household_id = v_hh),
      'skipped_months',     (select count(*) from public.skipped_months     where household_id = v_hh),
      'account_archive_periods', (select count(*) from public.account_archive_periods where household_id = v_hh),
      'ledger_entries',     (select count(*) from public.ledger_entries     where household_id = v_hh),
      'account_balances',   (select count(*) from public.account_balances   where household_id = v_hh)
    )
  );
end;
$$;

revoke all on function public.restore_into_new_household(jsonb) from public, anon;
grant execute on function public.restore_into_new_household(jsonb) to authenticated;
