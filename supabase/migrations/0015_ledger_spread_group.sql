alter table public.ledger_entries
  add column if not exists spread_group_id uuid;
