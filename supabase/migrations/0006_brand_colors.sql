update public.categories as c
set color = m.new_color
from (
  values
    ('#22c55e', '#d85700'),
    ('#16a34a', '#8c3b00'),
    ('#1db954', '#b8865a'),
    ('#f97316', '#d85700'),
    ('#f59e0b', '#f2a65a'),
    ('#eab308', '#f2a65a'),
    ('#facc15', '#f2a65a'),
    ('#ef4444', '#8c3b00'),
    ('#ec4899', '#b8865a'),
    ('#8b5cf6', '#9ca3af'),
    ('#a78bfa', '#9ca3af'),
    ('#7c3aed', '#4b5563'),
    ('#0ea5e9', '#6b7280'),
    ('#14b8a6', '#6b7280'),
    ('#06b6d4', '#6b7280'),
    ('#64748b', '#6b7280'),
    ('#475569', '#4b5563'),
    ('#3b82f6', '#9ca3af')
) as m(old_color, new_color)
where c.color = m.old_color;

update public.cards as c
set color = m.new_color
from (
  values
    ('#3b82f6', '#d85700'),
    ('#22c55e', '#d85700'),
    ('#f97316', '#f2a65a'),
    ('#8b5cf6', '#9ca3af'),
    ('#ef4444', '#8c3b00'),
    ('#14b8a6', '#6b7280'),
    ('#eab308', '#f2a65a'),
    ('#ec4899', '#b8865a'),
    ('#64748b', '#6b7280')
) as m(old_color, new_color)
where c.color = m.old_color;
