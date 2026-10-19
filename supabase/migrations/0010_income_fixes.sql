update public.categories set kind = 'income' where name = 'Sign Up Bonuses';

update public.ledger_entries as e
set kind = 'income', amount = abs(e.amount)
from public.categories as c
where e.category_id = c.id and c.name = 'Sign Up Bonuses';

update public.ledger_entries as e
set amount = abs(e.amount)
from public.categories as c
where e.category_id = c.id and c.kind = 'income' and e.amount < 0;

delete from public.ledger_entries
where id in (
  '6c4141e8-dfd0-407b-a9e5-6715efc89b46',
  '91681689-9dec-4a36-b026-c2ccdea243f9',
  '48d6e2cf-6f36-45c5-82cc-89af27caccee'
);

insert into public.recurring_items (household_id, category_id, amount, start_month, active)
select c.household_id, c.id, 7500, date '2025-01-01', true
from public.categories c
where c.name = 'Income';

update public.ledger_entries as e
set amount = 7500, recurring_item_id = r.id
from public.categories as c
join public.recurring_items as r
  on r.category_id = c.id and r.amount = 7500 and r.start_month = date '2025-01-01'
where e.category_id = c.id and c.name = 'Income';
