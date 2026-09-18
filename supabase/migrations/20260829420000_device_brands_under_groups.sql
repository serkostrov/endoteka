-- Бренды приборов принадлежат группе: Группа → Бренд → Модель → Модификация.

-- Код уникален в рамках родителя (один Olympus в разных группах — разные записи).
alter table public.reference_items
  drop constraint if exists reference_items_set_code_unique;

create unique index if not exists reference_items_set_parent_code_uidx
  on public.reference_items (set_id, parent_id, code)
  where parent_id is not null;

create unique index if not exists reference_items_set_root_code_uidx
  on public.reference_items (set_id, code)
  where parent_id is null;

update public.reference_sets brands
set
  parent_set_id = groups.id,
  description = 'Производители в рамках группы приборов',
  updated_at = now()
from public.reference_sets groups
where brands.code = 'device_brands'
  and groups.code = 'device_groups'
  and brands.parent_set_id is distinct from groups.id;

-- Существующие бренды без группы — к «Гибкий эндоскоп» (или первой группе).
update public.reference_items brands
set
  parent_id = coalesce(
    (
      select g.id
      from public.reference_items g
      join public.reference_sets gs on gs.id = g.set_id and gs.code = 'device_groups'
      where g.code = 'flexible_endoscope'
      limit 1
    ),
    (
      select g.id
      from public.reference_items g
      join public.reference_sets gs on gs.id = g.set_id and gs.code = 'device_groups'
      order by g.sort_order, g.name
      limit 1
    )
  ),
  updated_at = now()
from public.reference_sets brand_set
where brand_set.id = brands.set_id
  and brand_set.code = 'device_brands'
  and brands.parent_id is null
  and exists (
    select 1
    from public.reference_items g
    join public.reference_sets gs on gs.id = g.set_id and gs.code = 'device_groups'
  );

create or replace function public.assert_device_classification(
  device_group_id uuid,
  device_brand_id uuid,
  device_model_id uuid,
  device_modification_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  set_code text;
  parent uuid;
begin
  if device_group_id is not null then
    select s.code into set_code
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_group_id and i.is_active = true;
    if set_code is distinct from 'device_groups' then
      raise exception 'Некорректная группа прибора.';
    end if;
  end if;

  if device_brand_id is not null then
    select s.code, i.parent_id into set_code, parent
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_brand_id and i.is_active = true;
    if set_code is distinct from 'device_brands' then
      raise exception 'Некорректный бренд прибора.';
    end if;
    if device_group_id is not null and parent is distinct from device_group_id then
      raise exception 'Бренд не относится к выбранной группе.';
    end if;
  end if;

  if device_model_id is not null then
    select s.code, i.parent_id into set_code, parent
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_model_id and i.is_active = true;
    if set_code is distinct from 'device_models' then
      raise exception 'Некорректная модель прибора.';
    end if;
    if device_brand_id is not null and parent is distinct from device_brand_id then
      raise exception 'Модель не относится к выбранному бренду.';
    end if;
  end if;

  if device_modification_id is not null then
    select s.code, i.parent_id into set_code, parent
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_modification_id and i.is_active = true;
    if set_code is distinct from 'device_modifications' then
      raise exception 'Некорректная модификация прибора.';
    end if;
    if device_model_id is not null and parent is distinct from device_model_id then
      raise exception 'Модификация не относится к выбранной модели.';
    end if;
  end if;
end;
$$;
