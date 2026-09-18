-- Убрать демо-бренды / модели / модификации.
-- Снизу вверх: сначала модификации и модели (в т.ч. дочерние), потом бренды.

with brands_to_drop as (
  select i.id
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id
  where s.code = 'device_brands'
    and (
      i.is_system
      or i.code in ('olympus', 'pentax', 'fujifilm', 'karl_storz', 'other')
    )
),
models_to_drop as (
  select i.id
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id
  where s.code = 'device_models'
    and (
      i.is_system
      or i.code in ('gif_q150', 'cf_q150l')
      or i.parent_id in (select id from brands_to_drop)
    )
),
mods_to_drop as (
  select i.id
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id
  where s.code = 'device_modifications'
    and (
      i.is_system
      or i.code in ('gif_q150_std', 'gif_q150_nbi', 'cf_q150l_std')
      or i.parent_id in (select id from models_to_drop)
    )
),
deleted_mods as (
  delete from public.reference_items
  where id in (select id from mods_to_drop)
  returning id
),
deleted_models as (
  delete from public.reference_items
  where id in (select id from models_to_drop)
  returning id
)
delete from public.reference_items
where id in (select id from brands_to_drop);
