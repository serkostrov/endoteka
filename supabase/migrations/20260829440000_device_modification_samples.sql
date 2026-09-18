-- Демо-модификации под моделями Olympus (GIF-Q150, CF-Q150L).

insert into public.reference_items (set_id, parent_id, code, name, sort_order, is_system)
select mod_set.id, models.id, mods.code, mods.name, mods.sort_order, true
from (
  values
    ('gif_q150', 'gif_q150_std', 'Standard', 0),
    ('gif_q150', 'gif_q150_nbi', 'NBI', 1),
    ('cf_q150l', 'cf_q150l_std', 'Standard', 0)
) as mods(model_code, code, name, sort_order)
join public.reference_sets mod_set on mod_set.code = 'device_modifications'
join public.reference_items models on models.code = mods.model_code
join public.reference_sets model_set on model_set.id = models.set_id and model_set.code = 'device_models'
where not exists (
  select 1
  from public.reference_items existing
  where existing.set_id = mod_set.id
    and existing.code = mods.code
    and existing.parent_id is not distinct from models.id
);
