create table public.category_groups (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  color          text not null default '#6b7280' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, name),
  unique (id, household_id)
);

create index idx_category_groups_household on public.category_groups(household_id, sort_order);

alter table public.categories add column group_id uuid references public.category_groups(id) on delete set null;
alter table public.categories add column excluded boolean not null default false;

create index idx_categories_group on public.categories(household_id, group_id);

create trigger trg_category_groups_touch
  before update on public.category_groups
  for each row execute function public.touch_updated_at();

alter table public.category_groups enable row level security;

create policy category_groups_all on public.category_groups for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

grant select, insert, update, delete on public.category_groups to authenticated, service_role;
