with households as (
  select distinct household_id from public.cards
),
palette_src as (
  select g.household_id, g.color, 0 as priority, min(g.sort_order) as ord
  from public.category_groups as g
  where g.household_id in (select household_id from households)
  group by g.household_id, g.color
  union all
  select h.household_id, f.color, 1, f.ord
  from households as h
  cross join (
    values
      ('#d85700', 0),
      ('#f2a65a', 1),
      ('#8c3b00', 2),
      ('#b8865a', 3),
      ('#d1a37a', 4),
      ('#6b7280', 5),
      ('#9ca3af', 6),
      ('#4b5563', 7),
      ('#a15c1e', 8)
  ) as f(color, ord)
),
deduped as (
  select
    household_id,
    color,
    row_number() over (partition by household_id order by priority, ord) as raw_rn,
    row_number() over (partition by household_id, color order by priority, ord) as color_rn
  from palette_src
),
ordered as (
  select
    household_id,
    color,
    row_number() over (partition by household_id order by raw_rn) - 1 as idx,
    count(*) over (partition by household_id) as palette_size
  from deduped
  where color_rn = 1
),
ranked_cards as (
  select
    id,
    household_id,
    row_number() over (partition by household_id order by sort_order, name) - 1 as rn
  from public.cards
)
update public.cards as c
set color = p.color
from ranked_cards as r
join ordered as p
  on p.household_id = r.household_id
 and p.idx = r.rn % p.palette_size
where c.id = r.id;
