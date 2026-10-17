create table public.account_archive_periods (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  start_month    date not null check (date_trunc('month', start_month) = start_month),
  end_month      date check (end_month is null or (date_trunc('month', end_month) = end_month and end_month > start_month)),
  created_at     timestamptz not null default now()
);

create index idx_account_archive_periods_account on public.account_archive_periods(household_id, account_id);

alter table public.account_archive_periods enable row level security;

create policy account_archive_periods_all on public.account_archive_periods for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

grant select, insert, update, delete on public.account_archive_periods to authenticated, service_role;

update public.accounts set archived = false where archived = true;
