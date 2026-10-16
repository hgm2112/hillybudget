-- Enable UUID generation
create extension if not exists "pgcrypto";

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  theme text not null default 'system' check (theme in ('light','dark','system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text not null default '#6b7280',
  type text not null check (type in ('expense','income')),
  sort_order integer not null default 0,
  archived boolean not null default false,
  ideal_override numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text not null default '#6b7280',
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null,
  category_id uuid not null references public.categories(id) on delete restrict,
  card_id uuid references public.cards(id) on delete set null,
  amount numeric(12,2) not null,
  note text,
  recurring_item_id uuid,
  is_imported boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  card_id uuid references public.cards(id) on delete set null,
  amount numeric(12,2) not null,
  note text,
  start_month date not null,
  end_month date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  alter table public.entries drop constraint if exists entries_recurring_item_fk;
  alter table public.entries
    add constraint entries_recurring_item_fk
    foreign key (recurring_item_id) references public.recurring_items(id) on delete set null;
end $$;

create table if not exists public.income (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null,
  source text not null,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  type text not null check (type in ('liquid','retirement','loan')),
  color text not null default '#6b7280',
  sort_order integer not null default 0,
  archived boolean not null default false,
  original_amount numeric(12,2),
  interest_rate numeric(8,4),
  monthly_payment numeric(12,2),
  start_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.account_balances (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  month date not null,
  balance numeric(12,2) not null,
  contributions numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, month)
);

create table if not exists public.household_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  ideal_window text not null default 'trailing12' check (ideal_window in ('all','trailing12','trailing6')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_household_members_user on public.household_members(user_id);
create index if not exists idx_categories_household on public.categories(household_id);
create index if not exists idx_cards_household on public.cards(household_id);
create index if not exists idx_entries_household_month on public.entries(household_id, month);
create index if not exists idx_entries_household_category on public.entries(household_id, category_id);
create index if not exists idx_entries_card on public.entries(card_id);
create index if not exists idx_recurring_household on public.recurring_items(household_id);
create index if not exists idx_income_household_month on public.income(household_id, month);
create index if not exists idx_accounts_household on public.accounts(household_id);
create index if not exists idx_account_balances_household_month on public.account_balances(household_id, month);
create index if not exists idx_account_balances_account_month on public.account_balances(account_id, month);

-- membership helper
drop function if exists public.is_household_member(uuid) cascade;
create or replace function public.is_household_member(household_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = household_uuid and user_id = auth.uid()
  );
$$;

grant execute on function public.is_household_member(uuid) to authenticated;

-- create household
drop function if exists public.create_household(text);
create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  hid uuid;
  code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  loop
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  insert into public.households (name, invite_code, owner_id)
    values (household_name, code, auth.uid())
    returning id into hid;
  insert into public.household_members (household_id, user_id, role)
    values (hid, auth.uid(), 'owner');
  insert into public.household_settings (household_id) values (hid);
  return hid;
end;
$$;

grant execute on function public.create_household(text) to authenticated;

-- join household
drop function if exists public.join_household(text);
create or replace function public.join_household(invite text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select id into hid from public.households where invite_code = upper(trim(invite));
  if hid is null then
    raise exception 'Invalid invite code';
  end if;
  insert into public.household_members (household_id, user_id, role)
    values (hid, auth.uid(), 'member')
    on conflict (household_id, user_id) do nothing;
  return hid;
end;
$$;

grant execute on function public.join_household(text) to authenticated;

drop function if exists public.ideal_category_amount(uuid, uuid, date, text, numeric);
drop view if exists public.monthly_category_totals;

-- ideal spending view
create or replace view public.monthly_category_totals
with (security_invoker = true) as
select household_id, category_id, month, coalesce(sum(amount), 0)::numeric(12,2) as total
from public.entries
group by household_id, category_id, month;

grant select on public.monthly_category_totals to authenticated;

create or replace function public.ideal_category_amount(
  p_household_id uuid,
  p_category_id uuid,
  p_current_month date,
  p_window text default 'trailing12',
  p_override numeric default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result numeric;
  cutoff date;
begin
  if p_override is not null then
    return p_override;
  end if;
  if p_window = 'trailing6' then
    cutoff := (p_current_month - interval '6 months')::date;
  elsif p_window = 'all' then
    cutoff := date '1900-01-01';
  else
    cutoff := (p_current_month - interval '12 months')::date;
  end if;

  select coalesce(avg(total), 0)::numeric(12,2) into result
  from public.monthly_category_totals
  where household_id = p_household_id
    and category_id = p_category_id
    and month < p_current_month
    and month >= cutoff
    and total <> 0;

  return coalesce(result, 0);
end;
$$;

grant execute on function public.ideal_category_amount(uuid, uuid, date, text, numeric) to authenticated;

-- realtime
do $$
begin
  begin
    alter publication supabase_realtime add table public.entries;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.income;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.account_balances;
  exception when duplicate_object then null;
  end;
end $$;

-- RLS
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.cards enable row level security;
alter table public.entries enable row level security;
alter table public.recurring_items enable row level security;
alter table public.income enable row level security;
alter table public.accounts enable row level security;
alter table public.account_balances enable row level security;
alter table public.household_settings enable row level security;

drop policy if exists households_select on public.households;
create policy households_select on public.households for select to authenticated using (public.is_household_member(id));
drop policy if exists households_insert on public.households;
create policy households_insert on public.households for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists households_update on public.households;
create policy households_update on public.households for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists households_delete on public.households;
create policy households_delete on public.households for delete to authenticated using (owner_id = auth.uid());

drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members for select to authenticated using (public.is_household_member(household_id));
drop policy if exists members_insert on public.household_members;
create policy members_insert on public.household_members for insert to authenticated with check (
  exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid())
);
drop policy if exists members_update on public.household_members;
create policy members_update on public.household_members for update to authenticated using (
  exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid())
);
drop policy if exists members_delete on public.household_members;
create policy members_delete on public.household_members for delete to authenticated using (
  exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid())
);

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists categories_all on public.categories;
create policy categories_all on public.categories for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists cards_all on public.cards;
create policy cards_all on public.cards for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists entries_all on public.entries;
create policy entries_all on public.entries for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists recurring_all on public.recurring_items;
create policy recurring_all on public.recurring_items for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists income_all on public.income;
create policy income_all on public.income for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists accounts_all on public.accounts;
create policy accounts_all on public.accounts for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists account_balances_all on public.account_balances;
create policy account_balances_all on public.account_balances for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists household_settings_all on public.household_settings;
create policy household_settings_all on public.household_settings for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- updated_at trigger optional
do $$ declare t text; begin
  for t in select unnest(array['households','profiles','categories','cards','entries','recurring_items','income','accounts','account_balances','household_settings']) loop
    execute format('drop trigger if exists trg_%I_updated on public.%I', t, t);
  end loop;
end $$;

drop function if exists public.touch_updated_at();
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  for t in select unnest(array['households','profiles','categories','cards','entries','recurring_items','income','accounts','account_balances','household_settings']) loop
    execute format('drop trigger if exists trg_%I_updated on public.%I', t, t);
    execute format('create trigger trg_%I_updated before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- table privileges (RLS still restricts rows)
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated;
