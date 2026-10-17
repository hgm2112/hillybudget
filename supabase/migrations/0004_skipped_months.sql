create table public.skipped_months (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  month          date not null,
  created_at     timestamptz not null default now(),
  unique (household_id, month)
);

create index idx_skipped_months_household on public.skipped_months(household_id, month);

alter table public.skipped_months enable row level security;

create policy skipped_months_all on public.skipped_months for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

grant select, insert, update, delete on public.skipped_months to authenticated, service_role;
