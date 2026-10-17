-- DESTRUCTIVE: resets the public schema, then rebuilds it. Re-run from the top if it fails partway.
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres;
create extension if not exists pgcrypto;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated;
create extension if not exists pgcrypto;

create type public.member_role   as enum ('owner','member');
create type public.category_kind as enum ('expense','income');
create type public.account_kind  as enum ('liquid','retirement','loan');
create type public.import_status as enum ('started','completed','failed','duplicate');
create type public.theme_pref    as enum ('light','dark','system');

create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  theme        public.theme_pref not null default 'system',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  invite_code text not null unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         public.member_role not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  ideal_window text not null default 'trailing12' check (ideal_window in ('all','trailing12','trailing6')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.categories (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  kind           public.category_kind not null default 'expense',
  color          text not null default '#6b7280' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order     integer not null default 0,
  archived       boolean not null default false,
  ideal_override numeric(12,2),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, name),
  unique (id, household_id)
);

create table public.cards (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  color        text not null default '#6b7280' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order   integer not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, name),
  unique (id, household_id)
);

create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  kind            public.account_kind not null default 'liquid',
  color           text not null default '#6b7280' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order      integer not null default 0,
  archived        boolean not null default false,
  original_amount numeric(12,2),
  interest_rate   numeric(8,4),
  monthly_payment numeric(12,2),
  start_date      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (household_id, name),
  unique (id, household_id)
);

create table public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  requested_by     uuid references auth.users(id) on delete set null,
  source_filename  text,
  idempotency_key  text,
  status           public.import_status not null default 'started',
  row_counts       jsonb not null default '{}'::jsonb,
  warnings         jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (household_id, idempotency_key)
);

create table public.recurring_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id  uuid not null references public.categories(id) on delete restrict,
  card_id      uuid references public.cards(id) on delete set null,
  amount       numeric(12,2) not null check (amount >= 0),
  note         text,
  start_month  date not null check (date_trunc('month', start_month) = start_month),
  end_month    date check (end_month is null or date_trunc('month', end_month) = end_month),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_month is null or end_month >= start_month)
);

create table public.ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  month             date not null check (date_trunc('month', month) = month),
  category_id       uuid not null references public.categories(id) on delete restrict,
  card_id           uuid references public.cards(id) on delete set null,
  kind              public.category_kind not null,
  amount            numeric(12,2) not null,
  note              text,
  recurring_item_id uuid references public.recurring_items(id) on delete set null,
  import_batch_id   uuid references public.import_batches(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.account_balances (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  month           date not null check (date_trunc('month', month) = month),
  balance         numeric(12,2) not null,
  contributions   numeric(12,2),
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, month)
);

create index idx_household_members_user   on public.household_members(user_id);
create index idx_categories_household     on public.categories(household_id, sort_order);
create index idx_cards_household          on public.cards(household_id, sort_order);
create index idx_accounts_household       on public.accounts(household_id, sort_order);
create index idx_ledger_household_month   on public.ledger_entries(household_id, month);
create index idx_ledger_household_kind    on public.ledger_entries(household_id, kind, month);
create index idx_ledger_household_cat     on public.ledger_entries(household_id, category_id);
create index idx_ledger_card              on public.ledger_entries(card_id);
create index idx_ledger_recurring         on public.ledger_entries(recurring_item_id);
create index idx_ledger_import_batch      on public.ledger_entries(import_batch_id);
create index idx_recurring_household      on public.recurring_items(household_id);
create index idx_balances_household_month on public.account_balances(household_id, month);
create index idx_balances_account_month   on public.account_balances(account_id, month);
create index idx_import_batches_household on public.import_batches(household_id, created_at);

create view public.monthly_category_totals
with (security_invoker = true) as
select household_id, category_id, month, sum(amount)::numeric(12,2) as total
from public.ledger_entries
group by household_id, category_id, month;

create or replace function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = target_household and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(target_household uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = target_household and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_ledger_kind()
returns trigger language plpgsql set search_path = ''
as $$
begin
  select c.kind into new.kind from public.categories c where c.id = new.category_id;
  if new.kind is null then
    raise exception 'Unknown category %', new.category_id;
  end if;
  return new;
end;
$$;

create or replace function public.assert_ledger_refs()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from public.categories c where c.id = new.category_id and c.household_id = new.household_id) then
    raise exception 'category does not belong to household';
  end if;
  if new.card_id is not null and not exists (select 1 from public.cards c where c.id = new.card_id and c.household_id = new.household_id) then
    raise exception 'card does not belong to household';
  end if;
  if new.recurring_item_id is not null and not exists (select 1 from public.recurring_items r where r.id = new.recurring_item_id and r.household_id = new.household_id) then
    raise exception 'recurring item does not belong to household';
  end if;
  return new;
end;
$$;

create or replace function public.assert_balance_refs()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts a where a.id = new.account_id and a.household_id = new.household_id) then
    raise exception 'account does not belong to household';
  end if;
  return new;
end;
$$;

create or replace function public.create_household(household_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_household uuid := gen_random_uuid();
  v_code      text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.households h where h.invite_code = v_code);
  end loop;

  insert into public.households (id, name, invite_code, owner_id)
  values (v_household, trim(household_name), v_code, v_uid);

  insert into public.household_members (household_id, user_id, role)
  values (v_household, v_uid, 'owner');

  insert into public.household_settings (household_id) values (v_household);

  insert into public.categories (household_id, name, kind, color, sort_order)
  select v_household, c.name, c.kind::public.category_kind, c.color, c.ord
  from (values
    ('Groceries','expense','#22c55e',0),
    ('Eating Out','expense','#f97316',1),
    ('Gas','expense','#eab308',2),
    ('Electric','expense','#facc15',3),
    ('Water','expense','#0ea5e9',4),
    ('Mortgage','expense','#8b5cf6',5),
    ('House Maintenance','expense','#a78bfa',6),
    ('Car Gas','expense','#f59e0b',7),
    ('Car Loan','expense','#7c3aed',8),
    ('Trash','expense','#6b7280',9),
    ('Internet','expense','#14b8a6',10),
    ('Phone','expense','#06b6d4',11),
    ('Ebay Earnings','income','#16a34a',12),
    ('Ebay Spending','expense','#ef4444',13),
    ('Magic the Gathering','expense','#ec4899',14),
    ('Car Insurance','expense','#475569',15),
    ('Spotify','expense','#1db954',16),
    ('Tithe','expense','#64748b',17),
    ('Travel','expense','#3b82f6',18)
  ) as c(name, kind, color, ord);

  return v_household;
end;
$$;

create or replace function public.join_household(invite text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_household uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select h.id into v_household from public.households h where h.invite_code = upper(trim(invite));
  if v_household is null then
    raise exception 'Invalid invite code';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household, v_uid, 'member')
  on conflict (household_id, user_id) do nothing;

  return v_household;
end;
$$;

create or replace function public.ideal_category_amount(
  p_household_id uuid,
  p_category_id  uuid,
  p_current_month date,
  p_window       text default 'trailing12',
  p_override     numeric default null
)
returns numeric language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_cutoff date;
  v_result numeric;
begin
  if p_override is not null then
    return p_override;
  end if;
  if p_window = 'trailing6' then
    v_cutoff := (p_current_month - interval '6 months')::date;
  elsif p_window = 'all' then
    v_cutoff := date '1900-01-01';
  else
    v_cutoff := (p_current_month - interval '12 months')::date;
  end if;

  select coalesce(avg(total), 0)::numeric(12,2) into v_result
  from public.monthly_category_totals
  where household_id = p_household_id
    and category_id = p_category_id
    and month < p_current_month
    and month >= v_cutoff
    and total <> 0;

  return coalesce(v_result, 0);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','households','household_settings','categories','cards','accounts','import_batches','recurring_items','ledger_entries','account_balances']
  loop
    execute format('create trigger trg_%I_updated before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

create trigger trg_ledger_entries_kind before insert or update on public.ledger_entries
  for each row execute function public.set_ledger_kind();
create trigger trg_ledger_entries_refs before insert or update on public.ledger_entries
  for each row execute function public.assert_ledger_refs();
create trigger trg_account_balances_refs before insert or update on public.account_balances
  for each row execute function public.assert_balance_refs();

alter table public.profiles           enable row level security;
alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.household_settings enable row level security;
alter table public.categories         enable row level security;
alter table public.cards              enable row level security;
alter table public.accounts           enable row level security;
alter table public.import_batches     enable row level security;
alter table public.recurring_items    enable row level security;
alter table public.ledger_entries     enable row level security;
alter table public.account_balances   enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_insert on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy households_select on public.households for select to authenticated using (public.is_household_member(id));
create policy households_insert on public.households for insert to authenticated with check (owner_id = auth.uid());
create policy households_update on public.households for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy households_delete on public.households for delete to authenticated using (owner_id = auth.uid());

create policy members_select on public.household_members for select to authenticated using (public.is_household_member(household_id));
create policy members_insert on public.household_members for insert to authenticated with check (public.is_household_owner(household_id));
create policy members_update on public.household_members for update to authenticated using (public.is_household_owner(household_id)) with check (public.is_household_owner(household_id));
create policy members_delete on public.household_members for delete to authenticated using (public.is_household_owner(household_id));

create policy settings_select on public.household_settings for select to authenticated using (public.is_household_member(household_id));
create policy settings_insert on public.household_settings for insert to authenticated with check (public.is_household_member(household_id));
create policy settings_update on public.household_settings for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy categories_all on public.categories for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy cards_all      on public.cards      for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy accounts_all   on public.accounts   for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy recurring_all  on public.recurring_items  for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy ledger_all     on public.ledger_entries   for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy balances_all   on public.account_balances for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy import_batches_select on public.import_batches for select to authenticated using (public.is_household_member(household_id));

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant select on public.monthly_category_totals to authenticated;
grant execute on all functions in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.ledger_entries;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.account_balances; exception when duplicate_object then null; end;
end $$;
create or replace function public.import_expenses_batch(
  p_household_id     uuid,
  p_idempotency_key  text default null,
  p_payload          jsonb default '{}'::jsonb,
  p_balances_mode    text default 'skip'
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_exists uuid;
  v_key text := nullif(trim(p_idempotency_key), '');
  v_batch_id uuid := gen_random_uuid();
  v_existing record;
  v_category text;
  v_color text;
  v_kind text;
  v_cat_id uuid;
  v_card text;
  v_card_id uuid;
  v_acc text;
  v_acc_kind text;
  v_acc_id uuid;
  v_month date;
  v_amount numeric(12,2);
  v_bal numeric(12,2);
  v_match bigint;
  v_entries integer := 0;
  v_entries_skipped integer := 0;
  v_balances_ins integer := 0;
  v_balances_upd integer := 0;
  v_balances_skip integer := 0;
  v_categories integer := 0;
  v_cards integer := 0;
  v_accounts integer := 0;
  v_warnings jsonb := coalesce(p_payload->'warnings', '[]'::jsonb);
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select h.id into v_exists from public.households h where h.id = p_household_id for update;
  if v_exists is null then
    raise exception 'Household not found';
  end if;

  select m.role = 'owner' into v_is_owner
  from public.household_members m
  where m.household_id = p_household_id and m.user_id = v_uid;
  if coalesce(v_is_owner, false) is not true then
    raise exception 'Only household owners can import expenses';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_household_id::text));

  if v_key is not null then
    select * into v_existing
    from public.import_batches b
    where b.household_id = p_household_id and b.idempotency_key = v_key;
    if found then
      if v_existing.status = 'completed' then
        return jsonb_build_object('batch_id', v_existing.id, 'duplicate_request', true, 'idempotency_key', v_key)
               || (v_existing.row_counts);
      end if;
      raise exception 'A previous import with this request key did not complete';
    end if;
  end if;

  insert into public.import_batches (id, household_id, requested_by, source_filename, idempotency_key, status, warnings)
  values (v_batch_id, p_household_id, v_uid,
          nullif(trim(coalesce(p_payload->>'sourceFileName','')),''), v_key, 'started', v_warnings);

  for v_color, v_kind, v_category in
    select coalesce(c->>'color','#6b7280'), coalesce(c->>'kind', c->>'type','expense'), c->>'name'
    from jsonb_array_elements(coalesce(p_payload->'categories','[]'::jsonb)) as c
  loop
    v_cat_id := null;
    v_category := trim(coalesce(v_category,''));
    if v_category = '' then
      raise exception 'Import category row is missing a name';
    end if;
    v_kind := case when v_kind = 'income' then 'income' else 'expense' end;

    insert into public.categories (household_id, name, kind, color, sort_order, archived)
    values (p_household_id, v_category, v_kind::public.category_kind,
            case when v_color ~ '^#[0-9A-Fa-f]{6}$' then v_color else '#6b7280' end,
            (select coalesce(max(sort_order),-1)+1 from public.categories where household_id = p_household_id),
            false)
    on conflict (household_id, name) do nothing
    returning id into v_cat_id;

    if v_cat_id is null then
      select id into v_cat_id from public.categories where household_id = p_household_id and name = v_category;
    else
      v_categories := v_categories + 1;
    end if;
  end loop;

  for v_color, v_card in
    select coalesce(c->>'color','#6b7280'), c->>'name'
    from jsonb_array_elements(coalesce(p_payload->'cards','[]'::jsonb)) as c
  loop
    v_card_id := null;
    v_card := trim(coalesce(v_card,''));
    if v_card = '' then
      raise exception 'Import card row is missing a name';
    end if;

    insert into public.cards (household_id, name, color, sort_order, archived)
    values (p_household_id, v_card,
            case when v_color ~ '^#[0-9A-Fa-f]{6}$' then v_color else '#6b7280' end,
            (select coalesce(max(sort_order),-1)+1 from public.cards where household_id = p_household_id),
            false)
    on conflict (household_id, name) do nothing
    returning id into v_card_id;

    if v_card_id is null then
      select id into v_card_id from public.cards where household_id = p_household_id and name = v_card;
    else
      v_cards := v_cards + 1;
    end if;
  end loop;

  for v_color, v_acc_kind, v_acc in
    select coalesce(a->>'color','#6b7280'), coalesce(a->>'kind', a->>'type','liquid'), a->>'name'
    from jsonb_array_elements(coalesce(p_payload->'accounts','[]'::jsonb)) as a
  loop
    v_acc_id := null;
    v_acc := trim(coalesce(v_acc,''));
    if v_acc = '' then
      raise exception 'Import account row is missing a name';
    end if;
    v_acc_kind := case when v_acc_kind in ('liquid','retirement','loan') then v_acc_kind else 'liquid' end;

    insert into public.accounts (household_id, name, kind, color, sort_order, archived)
    values (p_household_id, v_acc, v_acc_kind::public.account_kind,
            case when v_color ~ '^#[0-9A-Fa-f]{6}$' then v_color else '#6b7280' end,
            (select coalesce(max(sort_order),-1)+1 from public.accounts where household_id = p_household_id),
            false)
    on conflict (household_id, name) do nothing
    returning id into v_acc_id;

    if v_acc_id is null then
      select id into v_acc_id from public.accounts where household_id = p_household_id and name = v_acc;
    else
      v_accounts := v_accounts + 1;
    end if;
  end loop;

  for v_month, v_category, v_card, v_amount in
    select (e->>'month')::date, e->>'category', nullif(trim(coalesce(e->>'card','')),''), (e->>'amount')::numeric(12,2)
    from jsonb_array_elements(coalesce(p_payload->'entries','[]'::jsonb)) as e
  loop
    select id into v_cat_id from public.categories where household_id = p_household_id and name = v_category;
    if v_cat_id is null then
      raise exception 'Import entry references an unknown category: %', coalesce(v_category,'<blank>');
    end if;

    v_card_id := null;
    if v_card is not null then
      select id into v_card_id from public.cards where household_id = p_household_id and name = v_card;
      if v_card_id is null then
        raise exception 'Import entry references an unknown card: %', v_card;
      end if;
    end if;

    select count(*) into v_match
    from public.ledger_entries
    where household_id = p_household_id and month = v_month and category_id = v_cat_id
      and card_id is not distinct from v_card_id and amount = v_amount and import_batch_id is not null;

    if v_match = 0 then
      insert into public.ledger_entries (household_id, month, category_id, card_id, kind, amount, note, import_batch_id, created_by)
      values (p_household_id, v_month, v_cat_id, v_card_id, 'expense', v_amount, 'Imported from Excel', v_batch_id, v_uid);
      v_entries := v_entries + 1;
    else
      v_entries_skipped := v_entries_skipped + 1;
    end if;
  end loop;

  for v_acc, v_month, v_bal in
    select a->>'name', (b->>'month')::date, (b->>'balance')::numeric(12,2)
    from jsonb_array_elements(coalesce(p_payload->'accounts','[]'::jsonb)) as a
    cross join lateral jsonb_array_elements(coalesce(a->'balances','[]'::jsonb)) as b
  loop
    v_acc_id := null;
    select id into v_acc_id from public.accounts where household_id = p_household_id and name = v_acc;
    if v_acc_id is null then
      raise exception 'Import balance references an unknown account: %', coalesce(v_acc,'<blank>');
    end if;

    select count(*) into v_match from public.account_balances where account_id = v_acc_id and month = v_month;

    if v_match = 0 then
      insert into public.account_balances (household_id, account_id, month, balance, import_batch_id)
      values (p_household_id, v_acc_id, v_month, v_bal, v_batch_id);
      v_balances_ins := v_balances_ins + 1;
    elsif lower(coalesce(p_balances_mode,'skip')) = 'replace' then
      update public.account_balances
        set balance = v_bal, household_id = p_household_id, import_batch_id = v_batch_id, updated_at = now()
        where account_id = v_acc_id and month = v_month;
      v_balances_upd := v_balances_upd + 1;
    else
      v_balances_skip := v_balances_skip + 1;
    end if;
  end loop;

  update public.import_batches
    set status = 'completed',
        row_counts = jsonb_build_object(
          'entries_inserted', v_entries,
          'entries_skipped_duplicates', v_entries_skipped,
          'balances_inserted', v_balances_ins,
          'balances_updated', v_balances_upd,
          'balances_skipped', v_balances_skip,
          'categories_created', v_categories,
          'cards_created', v_cards,
          'accounts_created', v_accounts),
        updated_at = now()
    where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'duplicate_request', false,
    'household_id', p_household_id,
    'entries_inserted', v_entries,
    'entries_skipped_duplicates', v_entries_skipped,
    'balances_inserted', v_balances_ins,
    'balances_updated', v_balances_upd,
    'balances_skipped', v_balances_skip,
    'categories_created', v_categories,
    'cards_created', v_cards,
    'accounts_created', v_accounts,
    'warnings', v_warnings);
end;
$$;

grant execute on function public.import_expenses_batch(uuid, text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
