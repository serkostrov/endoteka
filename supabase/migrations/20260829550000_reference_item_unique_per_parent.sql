-- Код уникален среди «соседей» (set + parent), не во всём справочнике:
-- одна модель под разными брендами — ок; два одинаковых бренда в одной группе — нет.

alter table public.reference_items
  drop constraint if exists reference_items_set_code_unique;

drop index if exists public.reference_items_set_code_unique;
drop index if exists public.reference_items_set_code_uidx;

create unique index if not exists reference_items_set_parent_code_uidx
  on public.reference_items (set_id, parent_id, code)
  where parent_id is not null;

create unique index if not exists reference_items_set_root_code_uidx
  on public.reference_items (set_id, code)
  where parent_id is null;

-- Название без дублей среди соседей (если уже есть дубликаты — индекс не создаём).
do $$
begin
  if not exists (
    select 1
    from public.reference_items
    where parent_id is not null
    group by set_id, parent_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists reference_items_set_parent_name_uidx
      on public.reference_items (set_id, parent_id, lower(btrim(name)))
      where parent_id is not null;
  end if;

  if not exists (
    select 1
    from public.reference_items
    where parent_id is null
    group by set_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists reference_items_set_root_name_uidx
      on public.reference_items (set_id, lower(btrim(name)))
      where parent_id is null;
  end if;
end $$;

create or replace function public.upsert_reference_item(
  target_id uuid,
  target_set_id uuid,
  item_code text,
  item_name text,
  item_description text default '',
  parent_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  normalized_name text;
  current_row public.reference_items%rowtype;
  result_id uuid;
  next_sort integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.reference_sets where id = target_set_id) then
    raise exception 'Справочник не найден.';
  end if;

  normalized_code := lower(btrim(coalesce(item_code, '')));
  normalized_name := btrim(coalesce(item_name, ''));

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if target_id is not null then
    select * into current_row from public.reference_items where id = target_id and set_id = target_set_id;
    if current_row.id is null then
      raise exception 'Запись справочника не найдена.';
    end if;

    if current_row.is_system and current_row.code <> normalized_code then
      raise exception 'Код системной записи нельзя изменить.';
    end if;

    update public.reference_items
    set
      code = case when current_row.is_system then current_row.code else normalized_code end,
      name = normalized_name,
      description = btrim(coalesce(item_description, '')),
      parent_id = parent_item_id
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.reference_items
    where set_id = target_set_id;

    insert into public.reference_items (set_id, parent_id, code, name, description, sort_order)
    values (
      target_set_id,
      parent_item_id,
      normalized_code,
      normalized_name,
      btrim(coalesce(item_description, '')),
      next_sort
    )
    returning id into result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'references.item_created' else 'references.item_updated' end,
    'reference_item',
    result_id::text,
    jsonb_build_object('set_id', target_set_id, 'code', normalized_code)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Запись с таким названием уже есть на этом уровне.';
end;
$$;
