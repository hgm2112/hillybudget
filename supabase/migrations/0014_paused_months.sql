-- Paused months: months the household has flagged as incomplete or unreliable
-- (for example the current month, which still has a full month of spending to
-- come). A paused month is excluded from the dashboard's income/expense
-- windows, from the stats page, and from the trailing-average ideal budget,
-- but its ledger entries are never hidden or deleted.

create table public.paused_months (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  month         date not null check (date_trunc('month', month) = month),
  created_at    timestamptz not null default now(),
  unique (household_id, month)
);

create index idx_paused_months_household on public.paused_months(household_id);

alter table public.paused_months enable row level security;

create policy paused_months_all on public.paused_months for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

grant select, insert, update, delete on public.paused_months to authenticated, service_role;

-- Same function as before, with paused months excluded from the average.
-- It stays security invoker, so the paused_months read is filtered by RLS
-- exactly like every other query in the app.
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

  select coalesce(avg(t.total), 0)::numeric(12,2) into v_result
  from public.monthly_category_totals t
  where t.household_id = p_household_id
    and t.category_id = p_category_id
    and t.month < p_current_month
    and t.month >= v_cutoff
    and t.total <> 0
    and not exists (
      select 1
      from public.paused_months pm
      where pm.household_id = p_household_id
        and pm.month = t.month
    );

  return coalesce(v_result, 0);
end;
$$;
