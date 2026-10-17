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
