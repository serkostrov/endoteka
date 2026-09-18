-- Бренды принадлежат группам (parent_set). Без автосоздания производителей.

update public.reference_sets brands
set
  parent_set_id = groups.id,
  description = coalesce(brands.description, 'Производители в рамках группы приборов'),
  updated_at = now()
from public.reference_sets groups
where brands.code = 'device_brands'
  and groups.code = 'device_groups'
  and brands.parent_set_id is distinct from groups.id;
